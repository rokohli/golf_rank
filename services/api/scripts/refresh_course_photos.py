#!/usr/bin/env python3
"""Refresh course photos with multiple, landscape-filtered candidates per course.

Replaces each targeted course's existing CourseImage rows with up to
--photos-per-course new candidates: Wikimedia Commons first, then Google
Places Photos (downloaded and re-hosted in R2) to fill any remainder. Every
candidate is filtered to a landscape aspect ratio (>=1.2:1) -- a cheap proxy
for "looks like a course photo" rather than a clubhouse interior, a person,
or a sign, since neither source exposes real subject metadata.

Usage:
    python -m scripts.refresh_course_photos --course-ids 1,2,3,4,210,213,999,1051
    python -m scripts.refresh_course_photos --course-ids 1,2 --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import delete, select

from app.core.config import Settings
from app.course_photos import (
    download_google_place_photo,
    find_google_places_photo_candidates,
    find_wikimedia_photos,
    resolve_google_place_id,
)
from app.db import make_engine, make_session_factory
from app.models import Course, CourseImage
from app.storage import make_r2_client, upload_object

CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--course-ids", required=True, help="Comma-separated course ids to refresh")
    parser.add_argument("--photos-per-course", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true", help="List candidates without calling any API or writing to the DB")
    args = parser.parse_args()

    course_ids = [int(part) for part in args.course_ids.split(",") if part.strip()]

    settings = Settings()
    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    with session_factory() as session:
        courses = session.execute(select(Course).where(Course.id.in_(course_ids))).scalars().all()
        courses_by_id = {course.id: course for course in courses}
        missing = [cid for cid in course_ids if cid not in courses_by_id]
        if missing:
            print(f"Warning: no such course(s): {missing}")

        if args.dry_run:
            print(f"{len(courses_by_id)} course(s) targeted (dry run, no API calls, no writes):")
            for cid in course_ids:
                if cid in courses_by_id:
                    print(f"  #{cid} {courses_by_id[cid].name}")
            return 0

        r2_client = None
        if settings.r2_account_id and settings.r2_access_key_id and settings.r2_secret_access_key:
            r2_client = make_r2_client(settings)

        headers = {"User-Agent": "GolfRank-CoursePhotoBackfill/1.0 (https://github.com/golf-rank/golf_rank)"}
        with httpx.Client(timeout=30, headers=headers) as client:
            for cid in course_ids:
                course = courses_by_id.get(cid)
                if course is None:
                    continue

                session.execute(delete(CourseImage).where(CourseImage.course_id == cid))

                rows: list[CourseImage] = []
                if course.latitude is not None and course.longitude is not None:
                    for photo in find_wikimedia_photos(
                        client, course_name=course.name, latitude=course.latitude, longitude=course.longitude,
                        limit=args.photos_per_course,
                    ):
                        rows.append(CourseImage(
                            course_id=cid,
                            external_url=photo.url,
                            alt_text=f"{course.name} course photo",
                            source_name=photo.source_name,
                            source_url=photo.source_url,
                            position=len(rows),
                            is_hero=len(rows) == 0,
                        ))

                remaining = args.photos_per_course - len(rows)
                if remaining > 0 and settings.google_places_api_key and r2_client and settings.r2_bucket_name:
                    if not course.google_place_id and course.latitude is not None and course.longitude is not None:
                        resolved_place_id = resolve_google_place_id(
                            client, api_key=settings.google_places_api_key, course_name=course.name,
                            latitude=course.latitude, longitude=course.longitude,
                        )
                        if resolved_place_id is not None:
                            owner = session.execute(
                                select(Course.id, Course.name).where(Course.google_place_id == resolved_place_id)
                            ).first()
                            if owner is not None and owner[0] != cid:
                                print(f"    Places resolved to #{owner[0]} {owner[1]}'s listing "
                                      f"(likely a duplicate catalog entry) -- skipping the Places fallback")
                            else:
                                course.google_place_id = resolved_place_id
                    if course.google_place_id:
                        candidates = find_google_places_photo_candidates(
                            client, api_key=settings.google_places_api_key, google_place_id=course.google_place_id,
                            course_name=course.name, limit=remaining,
                        )
                        for index, candidate in enumerate(candidates):
                            downloaded = download_google_place_photo(
                                client, api_key=settings.google_places_api_key, photo_name=candidate.name,
                            )
                            extension = CONTENT_TYPE_EXTENSIONS.get(downloaded.content_type, "jpg")
                            storage_key = f"courses/{cid}/photo-{len(rows) + 1}.{extension}"
                            upload_object(
                                r2_client, bucket=settings.r2_bucket_name, key=storage_key,
                                data=downloaded.data, content_type=downloaded.content_type,
                            )
                            rows.append(CourseImage(
                                course_id=cid,
                                storage_key=storage_key,
                                alt_text=f"{course.name} course photo",
                                source_name=candidate.source_name,
                                source_url=candidate.source_url,
                                position=len(rows),
                                is_hero=len(rows) == 0,
                            ))

                session.add_all(rows)
                session.commit()
                print(f"#{cid} {course.name}: {len(rows)} photo(s)")
                for row in rows:
                    location = row.external_url or row.storage_key
                    print(f"    {'HERO' if row.is_hero else '    '} {location} ({row.source_name})")

                if not rows:
                    print("    no landscape candidates found")

    return 0


if __name__ == "__main__":
    sys.exit(main())
