#!/usr/bin/env python3
"""Score user-submitted course photos that the upload-time scorer didn't.

The durable half of the scoring path. confirm_upload schedules an in-process
BackgroundTask so a photo is normally scored within seconds, but that task
holds nothing: a restart, a deploy, a busy concurrency slot, or a transient
provider failure all leave a photo unscored. This sweeps them up.

Selects USER photos that are still PENDING and have never been successfully
scored (scored_at IS NULL), skipping any whose course already has a
human-featured hero -- while one is set, is_hero outranks every score, so a
score could not change which photo wins.

Usage:
    python -m scripts.score_pending_course_photos --dry-run
    python -m scripts.score_pending_course_photos --limit 50
    python -m scripts.score_pending_course_photos --course-ids 210,213 --rescore
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from datetime import datetime, timedelta, timezone
from sqlalchemy import or_, select

from app.core.config import Settings
from app.course_images.repository import CourseImageRepository
from app.course_photo_scoring_job import (
    SCORING_ERRORS,
    load_reference_images,
    score_and_moderate_image,
    should_score,
)
from app.course_photos import WIKIMEDIA_USER_AGENT
from app.db import make_engine, make_session_factory
from app.models import CourseImage, CourseImageModeration, CourseImageSource

# Paced well below the provider's limit: a 429 slipped through at 1.0s during
# the original batch run, so this stays at the same 2.0s the sibling script uses.
REQUEST_DELAY_SECONDS = 2.0


def photos_to_score(
    session, settings, *, course_ids: list[int] | None = None,
    rescore: bool = False, limit: int = 100,
) -> tuple[list[CourseImage], int]:
    """The sweeper's selection. Returns (photos, skipped_for_locked_hero).

    Kept separate from main() so the selection rules -- which are the part
    worth getting wrong quietly -- can be tested without a provider.
    """
    repository = CourseImageRepository()
    now = datetime.now(timezone.utc)
    lease_cutoff = now - timedelta(seconds=300)
    query = select(CourseImage).where(
        CourseImage.source_type == CourseImageSource.USER,
        CourseImage.moderation_status == CourseImageModeration.PENDING,
        CourseImage.scoring_attempts < settings.course_photo_scoring_max_attempts,
        or_(
            CourseImage.scoring_claimed_at.is_(None),
            CourseImage.scoring_claimed_at < lease_cutoff,
        ),
    )
    if not rescore:
        # scored_at, not quality_score: a failed attempt leaves the score NULL.
        query = query.where(CourseImage.scored_at.is_(None))
    if course_ids:
        query = query.where(CourseImage.course_id.in_(course_ids))
    candidates = list(session.scalars(query.order_by(CourseImage.id)).all())

    # A pinned hero outranks every score, so scoring these would buy nothing.
    selected = [
        image for image in candidates
        if not repository.has_featured_hero(session, image.course_id)
    ]
    return selected[:limit], len(candidates) - len(selected)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--limit", type=int, default=100, help="Maximum photos to score in one run")
    parser.add_argument("--dry-run", action="store_true", help="Report what would be scored, write nothing")
    parser.add_argument("--course-ids", default=None, help="Restrict to these comma-separated course ids")
    parser.add_argument(
        "--rescore", action="store_true",
        help="Clear scored_at first, re-spending a call on every selected photo. "
             "For a changed prompt or model; requires --course-ids.",
    )
    args = parser.parse_args()

    if args.rescore and not args.course_ids:
        # Without a scope this would re-spend a provider call on the entire
        # backlog, which is never what someone means by "rescore".
        print("--rescore requires --course-ids.")
        return 1

    settings = Settings()
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set.")
        return 1
    if not settings.course_image_base_url:
        print("COURSE_IMAGE_BASE_URL is required to fetch photos for scoring.")
        return 1

    course_ids = (
        [int(part) for part in args.course_ids.split(",") if part.strip()]
        if args.course_ids else None
    )

    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(
        engine, course_image_base_url=settings.course_image_base_url
    )

    with session_factory() as session:
        pending, skipped = photos_to_score(
            session, settings, course_ids=course_ids,
            rescore=args.rescore, limit=args.limit,
        )
        if args.rescore and not args.dry_run:
            for image in pending:
                image.scored_at = None
            session.commit()

        if not pending:
            print(f"Nothing to score. ({skipped} skipped: course hero already featured)")
            return 0

        print(f"{len(pending)} photo(s) to score" + (f", {skipped} skipped (hero locked)" if skipped else ""))
        if args.dry_run:
            for image in pending:
                print(f"  would score image #{image.id} (course {image.course_id}, "
                      f"attempts={image.scoring_attempts})")
            print(f"Auto-approve threshold: {settings.course_photo_auto_approve_score}/10")
            return 0

        headers = {"User-Agent": WIKIMEDIA_USER_AGENT}
        with httpx.Client(timeout=30, headers=headers) as client:
            references = load_reference_images(session, settings, client, use_cache=False)
            if not references:
                print("No reference images available; cannot score without at least one.")
                return 1

            for image in pending:
                if not should_score(session, settings, image):
                    continue
                before = image.moderation_status
                try:
                    score_and_moderate_image(
                        session, settings, image.id,
                        client=client, reference_images=references,
                    )
                except SCORING_ERRORS as exc:
                    # score_and_moderate_image already records the attempt and
                    # swallows these; belt and braces so one bad photo can't
                    # end the run.
                    print(f"  #{image.id}: scoring failed ({exc})")
                    time.sleep(REQUEST_DELAY_SECONDS)
                    continue
                session.refresh(image)
                if image.quality_score is None:
                    print(f"  #{image.id}: failed (attempt {image.scoring_attempts})")
                else:
                    moved = " -> approved" if image.moderation_status != before else ""
                    print(f"  #{image.id}: {image.quality_score:.0f}/10{moved}  "
                          f"{'; '.join(image.quality_score_reasons or [])}")
                time.sleep(REQUEST_DELAY_SECONDS)

    return 0


if __name__ == "__main__":
    sys.exit(main())
