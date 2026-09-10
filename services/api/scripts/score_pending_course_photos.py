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
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

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
    now = datetime.now(timezone.utc)
    lease_cutoff = now - timedelta(seconds=300)

    hero_image = aliased(CourseImage)
    locked_hero_exists = (
        select(1)
        .where(
            hero_image.course_id == CourseImage.course_id,
            hero_image.source_type.in_((CourseImageSource.OFFICIAL, CourseImageSource.USER)),
            hero_image.is_hero.is_(True),
        )
        .exists()
    )

    base_conditions = [
        CourseImage.source_type == CourseImageSource.USER,
        CourseImage.moderation_status == CourseImageModeration.PENDING,
        or_(
            CourseImage.scoring_claimed_at.is_(None),
            CourseImage.scoring_claimed_at < lease_cutoff,
        ),
    ]
    if not rescore:
        # scored_at, not quality_score: a failed attempt leaves the score NULL.
        base_conditions.append(CourseImage.scored_at.is_(None))
        # The attempt ceiling is deliberately NOT applied in rescore mode.
        # claim_for_scoring spends an attempt *before* the provider call, so
        # transient failures (a brief provider outage, CDN lag on a
        # just-promoted object) burn the budget on photos that were never
        # actually scored. Applying the ceiling here too would leave those
        # permanently unreachable from every CLI path, with manual SQL as the
        # only recovery -- exactly what --rescore exists to avoid. main()
        # resets scoring_attempts for the rows it selects in this mode.
        base_conditions.append(
            CourseImage.scoring_attempts < settings.course_photo_scoring_max_attempts
        )
    if course_ids:
        base_conditions.append(CourseImage.course_id.in_(course_ids))

    skipped_count = session.scalar(
        select(func.count(CourseImage.id)).where(*base_conditions, locked_hero_exists)
    ) or 0

    selected_query = (
        select(CourseImage)
        .where(*base_conditions, ~locked_hero_exists)
        .order_by(CourseImage.id)
        .limit(limit)
    )
    selected = list(session.scalars(selected_query).all())
    return selected, skipped_count


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

    course_ids: list[int] | None = None
    if args.course_ids is not None:
        try:
            course_ids = [int(part) for part in args.course_ids.split(",") if part.strip()]
        except ValueError:
            print(f"Invalid --course-ids: {args.course_ids!r} (must be comma-separated integers).")
            return 1
        if not course_ids:
            print("--course-ids must contain at least one course id.")
            return 1

    if args.rescore and not course_ids:
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
                # Reset alongside scored_at: leaving attempts at the ceiling
                # would let this reselect the photo and then have
                # claim_for_scoring refuse it, so the run would report work it
                # silently never did.
                image.scoring_attempts = 0
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
