#!/usr/bin/env python3
"""Refresh courses with landscape-filtered Wikimedia Commons photos.

Usage:
    python -m scripts.refresh_course_photos --course-ids 1,2,3
    python -m scripts.refresh_course_photos --course-ids 1,2 --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import delete, select

from app.core.config import Settings
from app.course_photos import find_wikimedia_photos
from app.db import make_engine, make_session_factory
from app.models import Course, CourseImage


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--course-ids", required=True, help="Comma-separated course ids to refresh")
    parser.add_argument("--photos-per-course", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true", help="List targets without API calls or writes")
    args = parser.parse_args()

    course_ids = [int(part) for part in args.course_ids.split(",") if part.strip()]
    settings = Settings()
    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    with session_factory() as session:
        courses = session.execute(select(Course).where(Course.id.in_(course_ids))).scalars().all()
        courses_by_id = {course.id: course for course in courses}
        missing = [course_id for course_id in course_ids if course_id not in courses_by_id]
        if missing:
            print(f"Warning: no such course(s): {missing}")

        if args.dry_run:
            print(f"{len(courses_by_id)} course(s) targeted (dry run, no API calls, no writes):")
            for course_id in course_ids:
                if course_id in courses_by_id:
                    print(f"  #{course_id} {courses_by_id[course_id].name}")
            return 0

        headers = {"User-Agent": "GolfRank-CoursePhotoBackfill/1.0 (https://github.com/golf-rank/golf_rank)"}
        with httpx.Client(timeout=30, headers=headers) as client:
            for course_id in course_ids:
                course = courses_by_id.get(course_id)
                if course is None:
                    continue

                photos = find_wikimedia_photos(
                    client,
                    course_name=course.name,
                    latitude=course.latitude,
                    longitude=course.longitude,
                    limit=args.photos_per_course,
                )
                if not photos:
                    print(f"#{course_id} {course.name}: no landscape candidates found (keeping existing photos)")
                    continue

                rows = [
                    CourseImage(
                        course_id=course_id,
                        external_url=photo.url,
                        alt_text=f"{course.name} course photo",
                        source_name=photo.source_name,
                        source_url=photo.source_url,
                        license_name=photo.license_name,
                        license_url=photo.license_url,
                        position=index,
                        is_hero=index == 0,
                    )
                    for index, photo in enumerate(photos)
                ]
                session.execute(delete(CourseImage).where(CourseImage.course_id == course_id))
                session.add_all(rows)
                session.commit()
                print(f"#{course_id} {course.name}: {len(rows)} photo(s)")
                for row in rows:
                    print(f"    {'HERO' if row.is_hero else '    '} {row.external_url} ({row.source_name})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
