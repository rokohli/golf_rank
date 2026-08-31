#!/usr/bin/env python3
"""Score existing course photos against stated taste criteria using Gemini vision.

Downloads every CourseImage for each targeted course, scores it against the
criteria in app/course_photo_scoring.py (few-shot primed with the current
Crystal Springs and Cypress Point hero photos as reference "good" examples),
and prints a report. With --apply, re-picks each course's hero to whichever
candidate scored highest (only when it differs from the current hero). If the
best score is below --quality-floor, every photo for that course is removed
instead -- no photo is better than one that's clearly wrong.

Usage:
    python -m scripts.score_course_photos --course-ids 1,2,3,210,213,999,1051
    python -m scripts.score_course_photos --course-ids 1,2,3,210,213,999,1051 --apply --quality-floor 3
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import delete, select

from app.core.config import Settings
from app.course_photo_scoring import score_course_photo
from app.db import make_engine, make_session_factory
from app.domain import course_image_data, storage_image_url
from app.models import Course, CourseImage

REFERENCE_COURSE_IDS = [210, 213]  # Crystal Springs, Cypress Point
MODEL = "gemini-flash-lite-latest"
REQUEST_DELAY_SECONDS = 2.0  # paid tier; a 429 slipped through at 1.0, backing off further


def _fetch(client: httpx.Client, url: str) -> tuple[bytes, str]:
    response = client.get(url)
    response.raise_for_status()
    return response.content, response.headers.get("content-type", "image/jpeg")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--course-ids", required=True, help="Comma-separated course ids to score")
    parser.add_argument("--apply", action="store_true", help="Re-pick each course's hero to the top-scoring photo")
    parser.add_argument(
        "--quality-floor", type=int, default=None,
        help="If the best-scoring photo is below this, remove all photos for the course instead of applying one",
    )
    args = parser.parse_args()

    course_ids = [int(part) for part in args.course_ids.split(",") if part.strip()]

    settings = Settings()
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set.")
        return 1

    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    headers = {"User-Agent": "GolfRank-CoursePhotoBackfill/1.0 (https://github.com/golf-rank/golf_rank)"}
    with session_factory() as session:
        with httpx.Client(timeout=30, headers=headers) as client:
            reference_images = []
            for reference_id in REFERENCE_COURSE_IDS:
                course = session.get(Course, reference_id)
                if course is None:
                    print(f"Warning: reference course #{reference_id} does not exist, skipping it.")
                    continue
                hero = next((image for image in course_image_data(course) if image["is_hero"]), None)
                if hero is None:
                    print(f"Warning: reference course #{reference_id} has no hero photo, skipping it as a reference.")
                    continue
                data, content_type = _fetch(client, hero["url"])
                reference_images.append((data, content_type))
            if not reference_images:
                print("No reference images available; cannot score without at least one.")
                return 1

            for course_id in course_ids:
                course = session.get(Course, course_id)
                if course is None:
                    print(f"#{course_id}: no such course")
                    continue

                images = session.execute(
                    select(CourseImage).where(CourseImage.course_id == course_id).order_by(CourseImage.position)
                ).scalars().all()
                if not images:
                    print(f"#{course_id} {course.name}: no photos")
                    continue

                print(f"#{course_id} {course.name}")
                scored = []
                for image in images:
                    url = image.external_url or storage_image_url(settings.course_image_base_url, image.storage_key)
                    if url is None:
                        print(f"    skipping image #{image.id}: COURSE_IMAGE_BASE_URL is required for storage keys")
                        continue
                    data, content_type = _fetch(client, url)
                    score = score_course_photo(
                        client,
                        api_key=settings.gemini_api_key,
                        model=MODEL,
                        image_data=data,
                        image_content_type=content_type,
                        reference_images=reference_images,
                    )
                    scored.append((image, score))
                    tag = "HERO" if image.is_hero else "    "
                    print(f"    {tag} {score.score:>2}/10  {'; '.join(score.reasons)}")
                    time.sleep(REQUEST_DELAY_SECONDS)

                if not scored:
                    print("    no resolvable photos")
                    continue
                best_image, best_score = max(scored, key=lambda pair: pair[1].score)
                if args.apply:
                    if args.quality_floor is not None and best_score.score < args.quality_floor:
                        if len(scored) < len(images):
                            print(
                                f"    -> skipped quality-floor removal: only {len(scored)}/{len(images)} photos were scored"
                            )
                        else:
                            session.execute(delete(CourseImage).where(CourseImage.course_id == course_id))
                            session.commit()
                            print(f"    -> removed: best photo only scored {best_score.score}/10, "
                                  f"below the {args.quality_floor}/10 floor")
                    else:
                        changed = False
                        for image in images:
                            desired = image.id == best_image.id
                            if image.is_hero != desired:
                                image.is_hero = desired
                                changed = True
                        if changed:
                            session.commit()
                            print(f"    -> hero changed to the {best_score.score}/10 photo")

    return 0


if __name__ == "__main__":
    sys.exit(main())
