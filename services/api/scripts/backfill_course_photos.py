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
from app.course_photos import find_wikimedia_photos
from app.db import make_engine, make_session_factory
from app.models import Course, CourseImage, UserCourseRating


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
    """Fallback ordering for catalogs without enough community ratings yet."""
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
    parser.add_argument("--dry-run", action="store_true", help="List target courses without API calls or writes")
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

        hits = 0
        misses = 0
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
                    position=0,
                    is_hero=True,
                ))
                session.commit()
                hits += 1
                print(f"  #{course.id} {course.name}: Wikimedia Commons")

        print(f"\nDone. Commons: {hits}  Missed: {misses}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
