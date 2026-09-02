#!/usr/bin/env python3
"""Backfill attributable Wikimedia Commons photos for courses missing images.

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
from app.course_images.repository import CourseImageRepository
from app.course_images.service import WIKIMEDIA_PROVIDER_NAME
from app.course_photos import find_wikimedia_photos
from app.db import make_engine, make_session_factory
from app.models import Course, CourseImage, CourseImageModeration, UserCourseRating


def _courses_with_a_usable_photo(*, base_url_configured: bool):
    """Only an approved image with a resolvable URL counts as usable -- a
    rejected or still-pending image is invisible to the hero resolver
    (CourseImageRepository._best_approved), so a course with only one of
    those must still be backfilled rather than being permanently skipped.
    Likewise, a storage_key-only row is unresolvable (and therefore unusable,
    per _course_image_url/course_image_data) unless COURSE_IMAGE_BASE_URL is
    configured -- otherwise a course stuck with only such a row would never
    be targeted by this offline backfill."""
    query = select(CourseImage.course_id).where(CourseImage.moderation_status == CourseImageModeration.APPROVED)
    if base_url_configured:
        query = query.where(CourseImage.external_url.is_not(None) | CourseImage.storage_key.is_not(None))
    else:
        query = query.where(CourseImage.external_url.is_not(None))
    return query.distinct()


def top_rated_courses_missing_photos(session, limit: int, *, base_url_configured: bool) -> list[Course]:
    already_has_photo = _courses_with_a_usable_photo(base_url_configured=base_url_configured)
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


def courses_missing_photos_by_id(session, limit: int, *, base_url_configured: bool) -> list[Course]:
    """Fallback ordering for catalogs without enough community ratings yet."""
    already_has_photo = _courses_with_a_usable_photo(base_url_configured=base_url_configured)
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
    parser.add_argument("--dry-run", action="store_true", help="List target courses without API calls or writes")
    args = parser.parse_args()

    settings = Settings()
    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    with session_factory() as session:
        base_url_configured = bool(settings.course_image_base_url)
        courses = (
            top_rated_courses_missing_photos(session, args.limit, base_url_configured=base_url_configured)
            if args.order_by == "rating"
            else courses_missing_photos_by_id(session, args.limit, base_url_configured=base_url_configured)
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

        hits = 0
        misses = 0
        repository = CourseImageRepository()
        headers = {"User-Agent": "GolfRank-CoursePhotoBackfill/1.0 (https://github.com/golf-rank/golf_rank)"}
        with httpx.Client(timeout=30, headers=headers) as client:
            for course in courses:
                candidates = find_wikimedia_photos(
                    client,
                    course_name=course.name,
                    latitude=course.latitude,
                    longitude=course.longitude,
                    limit=1,
                )
                if not candidates:
                    misses += 1
                    print(f"  #{course.id} {course.name}: no photo found")
                    continue

                photo = candidates[0]
                session.add(CourseImage(
                    course_id=course.id,
                    external_url=photo.url,
                    alt_text=f"{course.name} course photo",
                    source_name=photo.source_name,
                    source_url=photo.source_url,
                    license_name=photo.license_name,
                    license_url=photo.license_url,
                    position=repository.next_position(session, course.id),
                    is_hero=True,
                ))
                # Clear any stale negative-cache entry so course-detail requests
                # start using this newly stored photo immediately, instead of
                # falling back to Mapbox/NONE for the rest of the negative TTL.
                repository.invalidate_negative_cache(session, course.id, WIKIMEDIA_PROVIDER_NAME, commit=False)
                session.commit()
                hits += 1
                print(f"  #{course.id} {course.name}: Wikimedia Commons")

        print(f"\nDone. Commons: {hits}  Missed: {misses}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
