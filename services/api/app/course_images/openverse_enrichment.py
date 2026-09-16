"""Shared Openverse enrichment logic for one course.

Implements the auto-accept / review-band / miss three-way branch exactly
once, so the live resolver (service.py), the admin manual-refresh endpoint,
and the offline backfill script can't drift out of sync on what counts as
each outcome.
"""

import logging
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from ..core.config import Settings
from .providers.openverse import HasCourseForOpenverse, OpenverseImageProvider
from .repository import CourseImageRepository
from .types import CourseImageResult

logger = logging.getLogger("golfrank.course_images")

OPENVERSE_PROVIDER_NAME = "openverse"

EnrichmentStatus = Literal["auto_accepted", "queued_for_review", "already_queued", "no_match"]


@dataclass(frozen=True)
class EnrichmentOutcome:
    status: EnrichmentStatus
    result: CourseImageResult | None = None


def enrich_course(
    session: Session,
    repository: CourseImageRepository,
    provider: OpenverseImageProvider,
    course: HasCourseForOpenverse,
    settings: Settings,
) -> EnrichmentOutcome:
    sibling_names = repository.sibling_course_names(session, course)
    lookup = provider.search(course, sibling_course_names=sibling_names)

    if lookup.result is not None and lookup.top_candidate is not None:
        top = lookup.top_candidate
        candidate = top.candidate
        existing = repository.best_openverse_image(session, course.id)
        common_kwargs = dict(
            external_url=candidate.url,
            thumbnail_url=candidate.thumbnail_url or candidate.url,
            alt_text=f"{course.name} course photo",
            source_name=candidate.source or "Openverse",
            source_url=candidate.foreign_landing_url,
            license_name=candidate.license.upper(),
            license_url=candidate.license_url,
            width=candidate.width,
            height=candidate.height,
            provider_asset_id=candidate.id,
            creator_name=candidate.creator,
            creator_url=candidate.creator_url,
            match_confidence_score=top.score.score,
            match_score_reasons=top.score.reasons,
            matched_query=top.matched_query,
        )
        if existing is not None:
            repository.update_openverse_image(session, existing, **common_kwargs)
        else:
            repository.add_openverse_image(session, course.id, **common_kwargs)
        repository.invalidate_negative_cache(session, course.id, OPENVERSE_PROVIDER_NAME)
        return EnrichmentOutcome(status="auto_accepted", result=lookup.result)

    outcome_status: EnrichmentStatus = "no_match"
    if lookup.top_candidate is not None and lookup.top_candidate.score.score >= settings.openverse_review_threshold:
        top = lookup.top_candidate
        candidate = top.candidate
        if repository.find_openverse_image_by_asset(session, course.id, candidate.id) is not None:
            outcome_status = "already_queued"
        else:
            repository.add_openverse_review_candidate(
                session, course.id,
                external_url=candidate.url,
                thumbnail_url=candidate.thumbnail_url or candidate.url,
                alt_text=f"{course.name} course photo",
                source_name=candidate.source or "Openverse",
                source_url=candidate.foreign_landing_url,
                license_name=candidate.license.upper(),
                license_url=candidate.license_url,
                width=candidate.width,
                height=candidate.height,
                provider_asset_id=candidate.id,
                creator_name=candidate.creator,
                creator_url=candidate.creator_url,
                match_confidence_score=top.score.score,
                match_score_reasons=top.score.reasons,
                matched_query=top.matched_query,
            )
            outcome_status = "queued_for_review"

    # A review-band candidate is never shown live -- from the live resolver's
    # perspective this is still "nothing to show right now", so it gets the
    # same negative-cache treatment as an outright miss (bounding how often a
    # course-detail request re-searches Openverse while the candidate sits in
    # the queue). The persisted review row itself is unaffected by this cache.
    try:
        repository.set_negative_cache(
            session, course.id, OPENVERSE_PROVIDER_NAME,
            ttl_seconds=settings.openverse_cache_negative_ttl_seconds,
        )
    except Exception:
        logger.warning("course_image_openverse_cache_write_failed course_id=%s", course.id, exc_info=True)
        session.rollback()
    return EnrichmentOutcome(status=outcome_status)
