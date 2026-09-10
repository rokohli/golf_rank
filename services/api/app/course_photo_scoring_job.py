"""Scoring a user-submitted photo and, above a threshold, auto-approving it.

Two callers share this module so their behavior can't drift:

  - course_photo_uploads.confirm_upload schedules run_scoring_task as a
    BackgroundTask, so a photo is normally scored within seconds of upload.
    This repo has no worker or scheduler (docker-compose runs db/redis/api and
    render.yaml declares a single web service), so an in-process background
    task is the only way to score on upload without new infrastructure. It is
    allowed to fail silently -- it holds nothing durable.
  - scripts/score_pending_course_photos.py is the durable backstop that picks
    up anything the fast path skipped, dropped on a restart, or failed on.

scored_at is what makes the two safe to run against each other: it is set once
scoring has been *attempted*, so neither re-scores a photo the other finished.

Auto-approval never sets is_hero. Approval only makes a photo eligible to win
its tier, ranked by quality_score; is_hero is reserved for a human's explicit
pick and outranks every score (see CourseImageRepository._rank_key). Keeping
them separate is what lets a moderator later feature a different photo and have
it actually win. There is likewise no auto-rejection: a low score leaves the
photo PENDING with its score and reasons visible in the moderation queue.
"""

import logging
import threading
import time

import httpx
from sqlalchemy.orm import Session

from .core.config import Settings
from .course_images.repository import CourseImageRepository
from .course_photo_scoring import PhotoScoringError, score_course_photo
from .course_photos import WIKIMEDIA_USER_AGENT
from .domain import course_image_data, storage_image_url
from .models import Course, CourseImage, CourseImageModeration, CourseImageSource

logger = logging.getLogger("golfrank.course_photo_scoring")

_repository = CourseImageRepository()

# Bounds concurrent provider calls started from the request process. Acquired
# non-blocking: a photo that can't get a slot is simply left for the sweeper,
# mirroring the fail-open discipline in CourseImageService._resolve_wikimedia
# rather than queuing threads behind an outbound HTTPS call.
_scoring_slots: threading.Semaphore | None = None
_scoring_slots_lock = threading.Lock()

# Reference images are the same two photos on every call, so re-fetching them
# per upload would triple this path's outbound image traffic for nothing.
_REFERENCE_CACHE_TTL_SECONDS = 3600.0
_reference_cache: tuple[float, list[tuple[bytes, str]]] | None = None
_reference_cache_lock = threading.Lock()

# Errors that mean "this attempt failed", not "this code is broken". Mirrors the
# tuple scripts/score_course_photos.py already catches per image.
SCORING_ERRORS = (PhotoScoringError, httpx.HTTPError, ValueError, KeyError)


_IMAGE_FAILURE_SIGNATURES = (
    "unable to process input image",
    "image decode",
    "image decoding",
    "failed to decode",
    "corrupt image",
    "corrupted image",
    "unsupported image",
    "invalid image",
    "cannot process image",
    "inline_data",
    "inlinedata",
    "unsupported mime type",
    "unsupported media type",
    "image format",
)


def is_permanent_scoring_failure(error: Exception) -> bool:
    """Whether retrying this photo could ever succeed.

    Only photo-specific payload errors (e.g. 400/422 when an image file is
    corrupt, unsupported format, or degenerate) represent permanent image failures
    that will never succeed on retry.

    Provider/configuration errors -- 400 with invalid schema/parameter/model config,
    401/403 (invalid or revoked API key, project permissions/quota), and 404
    (bad or retired configured model name) -- are system/configuration failures that
    affect the entire scorer rather than the photo. They must remain retryable so photos
    are not permanently failed before the configuration is fixed.

    Everything else -- timeouts, 5xx, 429, a transport error, an unparseable
    response -- is worth another attempt later.
    """
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status in {400, 422}:
            try:
                body_text = error.response.text.lower()
            except Exception:
                return False
            return any(sig in body_text for sig in _IMAGE_FAILURE_SIGNATURES)
    return False


def _slots(settings: Settings) -> threading.Semaphore:
    global _scoring_slots
    with _scoring_slots_lock:
        if _scoring_slots is None:
            _scoring_slots = threading.Semaphore(settings.course_photo_scoring_max_concurrent)
        return _scoring_slots


def fetch_image(client: httpx.Client, url: str) -> tuple[bytes, str]:
    response = client.get(url)
    response.raise_for_status()
    return response.content, response.headers.get("content-type", "image/jpeg")


def load_reference_images(
    session: Session, settings: Settings, client: httpx.Client, *, use_cache: bool = True,
) -> list[tuple[bytes, str]]:
    """The few-shot "this is the style we want" examples: each reference
    course's current hero photo."""
    global _reference_cache
    if use_cache:
        with _reference_cache_lock:
            if _reference_cache is not None and time.monotonic() - _reference_cache[0] < _REFERENCE_CACHE_TTL_SECONDS:
                return _reference_cache[1]

    images: list[tuple[bytes, str]] = []
    for course_id in settings.course_photo_scoring_reference_course_id_list:
        course = session.get(Course, course_id)
        if course is None:
            logger.warning("scoring_reference_course_missing course_id=%s", course_id)
            continue
        hero = next((image for image in course_image_data(course) if image["is_hero"]), None)
        if hero is None or not hero.get("url"):
            logger.warning("scoring_reference_hero_missing course_id=%s", course_id)
            continue
        try:
            images.append(fetch_image(client, hero["url"]))
        except httpx.HTTPError:
            logger.warning("scoring_reference_fetch_failed course_id=%s", course_id, exc_info=True)

    if use_cache and images:
        with _reference_cache_lock:
            _reference_cache = (time.monotonic(), images)
    return images


def should_score(session: Session, settings: Settings, image: CourseImage) -> bool:
    """Whether this photo is still worth spending a provider call on."""
    if image.source_type != CourseImageSource.USER:
        return False
    if image.moderation_status != CourseImageModeration.PENDING:
        return False
    # scored_at, not quality_score: a failed attempt leaves the score NULL, and
    # re-running would burn a call on the same image forever.
    if image.scored_at is not None:
        return False
    if (image.scoring_attempts or 0) >= settings.course_photo_scoring_max_attempts:
        return False
    # A human-featured hero outranks every score, so nothing this call learns
    # could change which photo wins. scored_at stays NULL, so the sweeper
    # reclaims this row if the hero is ever unfeatured.
    if _repository.has_featured_hero(session, image.course_id):
        return False
    return True


def score_and_moderate_image(
    session: Session,
    settings: Settings,
    image_id: int,
    *,
    client: httpx.Client,
    reference_images: list[tuple[bytes, str]],
    max_retries: int = 1,
) -> None:
    """Scores one photo and auto-approves it when it clears the threshold.

    Uses an atomic claim and conditional-write design so outbound HTTP calls
    never hold open a database transaction or lock, and late scoring results
    never overwrite human moderation decisions.
    """
    if not reference_images:
        logger.warning("scoring_skipped_no_reference_images image_id=%s", image_id)
        return

    claimed = _repository.claim_for_scoring(
        session, image_id, max_attempts=settings.course_photo_scoring_max_attempts,
    )
    if claimed is None:
        logger.info("scoring_skipped_cannot_claim image_id=%s", image_id)
        return

    claim_timestamp = claimed.scoring_claimed_at
    url = storage_image_url(settings.course_image_base_url, claimed.storage_key)
    if url is None:
        logger.warning("scoring_skipped_no_url image_id=%s", image_id)
        _repository.release_score_claim(session, image_id, claim_timestamp=claim_timestamp)
        return

    try:
        data, content_type = fetch_image(client, url)
    except httpx.HTTPError:
        # Most likely CDN propagation lag on a recently-promoted object.
        # Release the claim so the sweeper can retry later.
        logger.warning("scoring_image_fetch_failed image_id=%s", image_id, exc_info=True)
        _repository.release_score_claim(session, image_id, claim_timestamp=claim_timestamp)
        return

    try:
        score = score_course_photo(
            client,
            api_key=settings.gemini_api_key,
            model=settings.course_photo_scoring_model,
            image_data=data,
            image_content_type=content_type,
            reference_images=reference_images,
            max_retries=max_retries,
        )
    except SCORING_ERRORS as error:
        permanent = is_permanent_scoring_failure(error)
        logger.warning(
            "scoring_failed image_id=%s permanent=%s", image_id, permanent, exc_info=True
        )
        if permanent:
            _repository.record_permanent_score_failure(session, image_id, claim_timestamp=claim_timestamp)
        else:
            _repository.release_score_claim(session, image_id, claim_timestamp=claim_timestamp)
        return

    persisted = _repository.complete_scoring(
        session,
        image_id,
        claim_timestamp=claim_timestamp,
        score=score.score,
        reasons=score.reasons,
        auto_approve_score=settings.course_photo_auto_approve_score,
    )
    if persisted:
        logger.info(
            "course_photo_scored image_id=%s score=%s approved=%s",
            image_id, score.score, score.score >= settings.course_photo_auto_approve_score,
        )
    else:
        logger.info(
            "course_photo_score_discarded image_id=%s reason=superseded_or_ineligible",
            image_id,
        )


def run_scoring_task(app, image_id: int) -> None:
    """BackgroundTask entry point. Opens its own session -- the request's
    session is closed by the time this runs (db.get_session is a with-scoped
    generator) -- and swallows everything, since a scoring failure must never
    surface as an error on an upload that already succeeded."""
    settings = app.state.settings
    slots = _slots(settings)
    if not slots.acquire(blocking=False):
        logger.info("course_photo_scoring_deferred image_id=%s reason=busy", image_id)
        return
    try:
        headers = {"User-Agent": WIKIMEDIA_USER_AGENT}
        with httpx.Client(
            timeout=settings.course_photo_scoring_timeout_seconds, headers=headers
        ) as client:
            with app.state.session_factory() as session:
                references = load_reference_images(session, settings, client)
                score_and_moderate_image(
                    session, settings, image_id,
                    client=client, reference_images=references,
                )
    except Exception:
        logger.warning("course_photo_scoring_task_failed image_id=%s", image_id, exc_info=True)
    finally:
        slots.release()
