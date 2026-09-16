#!/usr/bin/env python3
"""Backfill/refresh Openverse-matched course photos.

Targets courses whose only approved image (if any) is Wikimedia-sourced --
adding Openverse as a higher-priority tier than Wikimedia means those courses
are worth re-checking, not just courses with no image at all.

Usage:
    python -m scripts.backfill_openverse_photos --limit 50
    python -m scripts.backfill_openverse_photos --limit 50 --dry-run
    python -m scripts.backfill_openverse_photos --course-ids 1,2,3
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import func, select

from app.core.config import Settings
from app.course_images.openverse_enrichment import enrich_course
from app.course_images.providers.openverse import OpenverseImageProvider
from app.course_images.providers.openverse_auth import OpenverseTokenManager
from app.course_images.repository import CourseImageRepository
from app.db import make_engine, make_session_factory
from app.models import Course, CourseImage, CourseImageModeration, CourseImageSource, UserCourseRating

# Batch jobs can absorb a transient blip with growing backoff -- unlike the
# live per-request path (max_retries=0), which must not block a held DB
# session/lock.
_BATCH_MAX_RETRIES = 3
# The live resolver bounds one course's ENTIRE query cascade (up to 4
# sequential queries) to openverse_lookup_timeout_seconds (5s default) since
# it's blocking a course-detail page load. A batch job has no such deadline --
# reusing that 5s budget here, now that retries-with-backoff are also enabled,
# left barely enough time for one query, let alone four with retries, causing
# most courses to fail on "deadline exceeded" rather than a real answer. This
# budget is per-course, independent of the live path's setting.
_BATCH_SEARCH_BUDGET_SECONDS = 60.0


def _courses_already_covered(*, base_url_configured: bool):
    """Courses that already have an approved OFFICIAL/USER/OPENVERSE image --
    i.e. a tier Openverse can't or shouldn't try to upgrade. A Wikimedia-only
    course is deliberately NOT included here."""
    query = select(CourseImage.course_id).where(
        CourseImage.moderation_status == CourseImageModeration.APPROVED,
        CourseImage.source_type.in_(
            (CourseImageSource.OFFICIAL, CourseImageSource.USER, CourseImageSource.OPENVERSE)
        ),
    )
    if base_url_configured:
        query = query.where(CourseImage.external_url.is_not(None) | CourseImage.storage_key.is_not(None))
    else:
        query = query.where(CourseImage.external_url.is_not(None))
    return query.distinct()


def top_rated_courses_missing_photos(session, limit: int, *, base_url_configured: bool) -> list[Course]:
    already_covered = _courses_already_covered(base_url_configured=base_url_configured)
    rows = session.execute(
        select(Course, func.avg(UserCourseRating.rating).label("avg_rating"))
        .join(UserCourseRating, UserCourseRating.course_id == Course.id)
        .where(Course.status == "active", Course.id.not_in(already_covered))
        .group_by(Course.id)
        .having(func.count(UserCourseRating.id) >= 1)
        .order_by(func.avg(UserCourseRating.rating).desc(), func.count(UserCourseRating.id).desc())
        .limit(limit)
    ).all()
    return [row[0] for row in rows]


def courses_missing_photos_by_id(
    session, limit: int, *, base_url_configured: bool, min_id: int | None = None,
) -> list[Course]:
    already_covered = _courses_already_covered(base_url_configured=base_url_configured)
    query = select(Course).where(Course.status == "active", Course.id.not_in(already_covered))
    if min_id is not None:
        query = query.where(Course.id > min_id)
    return list(session.execute(query.order_by(Course.id).limit(limit)).scalars())


def courses_by_id(session, course_ids: list[int]) -> list[Course]:
    return list(session.execute(select(Course).where(Course.id.in_(course_ids))).scalars())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--limit", type=int, default=50, help="Number of courses to backfill")
    group.add_argument("--course-ids", type=str, help="Comma-separated course ids to explicitly (re)search")
    parser.add_argument(
        "--order-by", choices=["rating", "id"], default="rating",
        help="Only used with --limit: 'rating' prioritizes highest-rated courses; "
             "'id' is a deterministic fallback for catalogs without enough ratings yet",
    )
    parser.add_argument(
        "--min-id", type=int, default=None,
        help="Only used with --order-by id: resume an id-ordered sweep past this id, "
             "skipping courses already checked in an earlier run",
    )
    parser.add_argument("--dry-run", action="store_true", help="List target courses without API calls or writes")
    args = parser.parse_args()

    settings = Settings()
    if not settings.openverse_enabled:
        print("OPENVERSE_ENABLED is false -- nothing to do.")
        return 0

    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    with session_factory() as session:
        base_url_configured = bool(settings.course_image_base_url)
        if args.course_ids:
            course_ids = [int(part.strip()) for part in args.course_ids.split(",") if part.strip()]
            courses = courses_by_id(session, course_ids)
        else:
            courses = (
                top_rated_courses_missing_photos(session, args.limit, base_url_configured=base_url_configured)
                if args.order_by == "rating"
                else courses_missing_photos_by_id(
                    session, args.limit, base_url_configured=base_url_configured, min_id=args.min_id,
                )
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

        token_client = httpx.Client(timeout=settings.openverse_lookup_timeout_seconds)
        token_manager = OpenverseTokenManager(
            client=token_client, token_url=settings.openverse_token_url,
            client_id=settings.openverse_client_id, client_secret=settings.openverse_client_secret,
            timeout_seconds=settings.openverse_lookup_timeout_seconds,
            max_retries=_BATCH_MAX_RETRIES,
            retry_budget_seconds=_BATCH_SEARCH_BUDGET_SECONDS,
        )
        provider = OpenverseImageProvider(
            api_base_url=settings.openverse_api_base_url, token_manager=token_manager,
            timeout_seconds=settings.openverse_lookup_timeout_seconds,
            auto_accept_threshold=settings.openverse_auto_accept_threshold,
            min_width=settings.openverse_min_width,
            allowed_licenses=settings.openverse_allowed_license_set,
            max_retries=_BATCH_MAX_RETRIES,
            search_budget_seconds=_BATCH_SEARCH_BUDGET_SECONDS,
        )
        repository = CourseImageRepository()

        counts = {"auto_accepted": 0, "queued_for_review": 0, "already_queued": 0, "no_match": 0, "error": 0}
        try:
            for course in courses:
                # A single course's transient failure (network blip, rate
                # limit, malformed response) must not abort the rest of an
                # hours-long batch run -- skip it and keep going, same
                # fail-open philosophy as the live resolver's own try/except.
                try:
                    outcome = enrich_course(session, repository, provider, course, settings)
                except Exception as exc:
                    session.rollback()
                    counts["error"] += 1
                    print(f"  #{course.id} {course.name}: error ({exc})")
                    continue
                counts[outcome.status] = counts.get(outcome.status, 0) + 1
                print(f"  #{course.id} {course.name}: {outcome.status}")
        finally:
            provider.close()
            token_client.close()

        print(
            f"\nDone. Auto-accepted: {counts['auto_accepted']}  "
            f"Queued for review: {counts['queued_for_review']}  "
            f"Already queued: {counts['already_queued']}  "
            f"No match: {counts['no_match']}  "
            f"Errors: {counts['error']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
