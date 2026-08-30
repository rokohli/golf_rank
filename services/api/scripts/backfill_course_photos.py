#!/usr/bin/env python3
"""Backfill real course photos for the highest-rated courses.

Tries Wikimedia Commons first (free, geo-tagged, pre-attributed photos linked
directly by URL). Falls back to the Google Places Photos API for courses
Commons has no coverage for, downloading the photo and re-hosting it in R2.
Courses without a stored google_place_id are resolved via Places Text
Search first (and the resolved id is saved back onto the course).

Usage:
    python -m scripts.backfill_course_photos --limit 50
    python -m scripts.backfill_course_photos --limit 50 --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import func, select

from app.core.config import Settings
from app.course_photos import (
    download_google_place_photo,
    find_google_places_photo_candidates,
    find_wikimedia_photos,
    resolve_google_place_id,
)
from app.db import make_engine, make_session_factory
from app.models import Course, CourseImage, UserCourseRating
from app.storage import make_r2_client, upload_object

CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def top_rated_courses_missing_photos(session, limit: int) -> list[Course]:
    already_has_photo = select(CourseImage.course_id).distinct()
    rows = session.execute(
        select(Course, func.avg(UserCourseRating.rating).label("avg_rating"))
        .join(UserCourseRating, UserCourseRating.course_id == Course.id)
        .where(Course.status == "active", Course.id.not_in(already_has_photo))
        .group_by(Course.id)
        .having(func.count(UserCourseRating.id) >= 1)
        .order_by(func.avg(UserCourseRating.rating).desc(), func.count(UserCourseRating.id).desc())
        .limit(limit)
    ).all()
    return [row[0] for row in rows]


def courses_missing_photos_by_id(session, limit: int) -> list[Course]:
    """Fallback ordering for catalogs without enough (or any) community ratings yet."""
    already_has_photo = select(CourseImage.course_id).distinct()
    return list(session.execute(
        select(Course)
        .where(Course.status == "active", Course.id.not_in(already_has_photo))
        .order_by(Course.id)
        .limit(limit)
    ).scalars())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=50, help="Number of courses to backfill")
    parser.add_argument(
        "--order-by", choices=["rating", "id"], default="rating",
        help="'rating' prioritizes the highest community-rated courses missing photos; "
             "'id' is a deterministic fallback for catalogs without enough ratings yet",
    )
    parser.add_argument("--dry-run", action="store_true", help="List target courses without calling any API or writing to the DB")
    args = parser.parse_args()

    settings = Settings()
    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    with session_factory() as session:
        courses = (
            top_rated_courses_missing_photos(session, args.limit) if args.order_by == "rating"
            else courses_missing_photos_by_id(session, args.limit)
        )
        if not courses:
            print("No courses need photos.")
            return 0

        print(f"{len(courses)} course(s) targeted:")
        for course in courses:
            print(f"  #{course.id} {course.name} ({course.region})")

        if args.dry_run:
            print("\nDry run: no API calls made, no rows written.")
            return 0

        if not settings.google_places_api_key:
            print("\nWarning: GOOGLE_PLACES_API_KEY is not set; the Places fallback will be skipped.")

        r2_client = None
        if settings.r2_account_id and settings.r2_access_key_id and settings.r2_secret_access_key:
            r2_client = make_r2_client(settings)

        commons_hits = 0
        places_hits = 0
        misses = 0

        headers = {"User-Agent": "GolfRank-CoursePhotoBackfill/1.0 (https://github.com/golf-rank/golf_rank)"}
        with httpx.Client(timeout=30, headers=headers) as client:
            for course in courses:
                photo = None
                if course.latitude is not None and course.longitude is not None:
                    candidates = find_wikimedia_photos(
                        client, course_name=course.name, latitude=course.latitude, longitude=course.longitude,
                        limit=1,
                    )
                    photo = candidates[0] if candidates else None

                if photo is not None:
                    session.add(CourseImage(
                        course_id=course.id,
                        external_url=photo.url,
                        alt_text=f"{course.name} course photo",
                        source_name=photo.source_name,
                        source_url=photo.source_url,
                        position=0,
                        is_hero=True,
                    ))
                    session.commit()
                    commons_hits += 1
                    print(f"  #{course.id} {course.name}: Wikimedia Commons")
                    continue

                if not (settings.google_places_api_key and r2_client and settings.r2_bucket_name):
                    misses += 1
                    print(f"  #{course.id} {course.name}: no photo found")
                    continue

                if not course.google_place_id and course.latitude is not None and course.longitude is not None:
                    resolved_place_id = resolve_google_place_id(
                        client,
                        api_key=settings.google_places_api_key,
                        course_name=course.name,
                        latitude=course.latitude,
                        longitude=course.longitude,
                    )
                    if resolved_place_id is not None:
                        owner = session.execute(
                            select(Course.id, Course.name).where(Course.google_place_id == resolved_place_id)
                        ).first()
                        if owner is not None and owner[0] != course.id:
                            print(f"  #{course.id} {course.name}: Places resolved to #{owner[0]} {owner[1]}'s "
                                  f"listing (likely a duplicate catalog entry) -- skipping")
                        else:
                            course.google_place_id = resolved_place_id
                            session.commit()

                if not course.google_place_id:
                    misses += 1
                    print(f"  #{course.id} {course.name}: no photo found")
                    continue

                place_candidates = find_google_places_photo_candidates(
                    client,
                    api_key=settings.google_places_api_key,
                    google_place_id=course.google_place_id,
                    course_name=course.name,
                    limit=1,
                )
                if not place_candidates:
                    misses += 1
                    print(f"  #{course.id} {course.name}: no photo found")
                    continue
                candidate = place_candidates[0]
                downloaded = download_google_place_photo(
                    client, api_key=settings.google_places_api_key, photo_name=candidate.name,
                )

                extension = CONTENT_TYPE_EXTENSIONS.get(downloaded.content_type, "jpg")
                storage_key = f"courses/{course.id}/photo-1.{extension}"
                upload_object(
                    r2_client,
                    bucket=settings.r2_bucket_name,
                    key=storage_key,
                    data=downloaded.data,
                    content_type=downloaded.content_type,
                )
                session.add(CourseImage(
                    course_id=course.id,
                    storage_key=storage_key,
                    alt_text=f"{course.name} course photo",
                    source_name=candidate.source_name,
                    source_url=candidate.source_url,
                    position=0,
                    is_hero=True,
                ))
                session.commit()
                places_hits += 1
                print(f"  #{course.id} {course.name}: Google Places (via R2)")

        print(f"\nDone. Commons: {commons_hits}  Places: {places_hits}  Missed: {misses}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
