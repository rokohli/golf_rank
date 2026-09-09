import json

import httpx
import pytest
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.course_images.repository import CourseImageRepository
from app.course_photo_scoring_job import (
    load_reference_images,
    run_scoring_task,
    score_and_moderate_image,
    should_score,
)
from app.db import make_engine, make_session_factory
from app.models import (
    Base,
    Course,
    CourseImage,
    CourseImageModeration,
    CourseImageSource,
)

CDN = "https://cdn.example"
IMAGE_BYTES = b"\xff\xd8\xff\xe0 fake jpeg"


@pytest.fixture()
def session() -> Session:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine, course_image_base_url=CDN)
    with factory() as db_session:
        yield db_session


def _settings(**overrides) -> Settings:
    base = dict(
        wikimedia_live_lookup_enabled=False,
        course_image_base_url=CDN,
        gemini_api_key="test-key",
        course_photo_autoscore_on_confirm=True,
        course_photo_auto_approve_score=8.0,
        course_photo_scoring_reference_course_ids="900",
    )
    base.update(overrides)
    return Settings(**base)


def _course(session: Session, name: str = "Pasatiempo", course_id: int | None = None) -> Course:
    course = Course(id=course_id, name=name, region="CA", latitude=37.0, longitude=-122.0)
    session.add(course)
    session.commit()
    return course


def _reference_course(session: Session) -> None:
    """A course whose approved hero acts as the few-shot example."""
    course = _course(session, name="Reference", course_id=900)
    session.add(CourseImage(
        course_id=course.id, storage_key="course-photos/900/hero.jpg", position=0,
        is_hero=True, source_type=CourseImageSource.OFFICIAL,
        moderation_status=CourseImageModeration.APPROVED,
    ))
    session.commit()


def _photo(
    session: Session, course: Course, *,
    status: str = CourseImageModeration.PENDING,
    source_type: str = CourseImageSource.USER,
    scored_at=None, attempts: int = 0, is_hero: bool = False,
) -> CourseImage:
    image = CourseImage(
        course_id=course.id,
        storage_key=f"course-photos/{course.id}/candidate-{status}-{source_type}.jpg",
        position=CourseImageRepository().next_position(session, course.id),
        is_hero=is_hero,
        source_type=source_type,
        moderation_status=status,
        scored_at=scored_at,
        scoring_attempts=attempts,
    )
    session.add(image)
    session.commit()
    return image


def _gemini_body(score: int, reasons: list[str]) -> dict:
    return {"candidates": [{
        "finishReason": "STOP",
        "content": {"parts": [{"text": json.dumps({"score": score, "reasons": reasons})}]},
    }]}


def _client(*, score: int = 9, reasons=("wide fairway",), gemini_status: int = 200,
            candidate_image_status: int = 200) -> tuple[httpx.Client, list[str]]:
    """Serves image bytes for CDN GETs and a Gemini response for the POST.

    candidate_image_status applies only to the photo under test -- reference
    images must keep resolving, or the scorer bails before it ever reaches the
    candidate and the test would pass for the wrong reason.
    """
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url}")
        if request.method == "GET":
            if "candidate" in str(request.url) and candidate_image_status != 200:
                return httpx.Response(candidate_image_status)
            return httpx.Response(200, content=IMAGE_BYTES, headers={"content-type": "image/jpeg"})
        if gemini_status != 200:
            return httpx.Response(gemini_status, json={"error": "nope"})
        return httpx.Response(200, json=_gemini_body(score, list(reasons)))

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def _score(session: Session, settings: Settings, image: CourseImage, client: httpx.Client) -> None:
    references = load_reference_images(session, settings, client, use_cache=False)
    score_and_moderate_image(
        session, settings, image.id, client=client, reference_images=references
    )
    session.refresh(image)


# --- scoring outcomes -----------------------------------------------------


def test_a_high_score_auto_approves_without_featuring(session: Session) -> None:
    _reference_course(session)
    settings = _settings()
    image = _photo(session, _course(session))
    client, _ = _client(score=9, reasons=["wide fairway", "elevated"])

    _score(session, settings, image, client)

    assert image.quality_score == 9.0
    assert image.quality_score_reasons == ["wide fairway", "elevated"]
    assert image.scored_at is not None
    assert image.scoring_attempts == 1
    assert image.moderation_status == CourseImageModeration.APPROVED
    # A machine decision leaves the reviewer NULL...
    assert image.moderated_by_user_id is None
    assert image.moderation_reason == "auto:gemini"
    # ...and must never take the explicit hero slot, which is a human's to give.
    assert image.is_hero is False


def test_a_low_score_is_recorded_but_stays_pending(session: Session) -> None:
    _reference_course(session)
    image = _photo(session, _course(session))
    client, _ = _client(score=3)

    _score(session, _settings(), image, client)

    assert image.quality_score == 3.0
    assert image.scored_at is not None
    # There is no auto-rejection: a weak photo waits for a human.
    assert image.moderation_status == CourseImageModeration.PENDING


def test_a_score_exactly_at_the_threshold_approves(session: Session) -> None:
    _reference_course(session)
    image = _photo(session, _course(session))
    client, _ = _client(score=8)

    _score(session, _settings(course_photo_auto_approve_score=8.0), image, client)

    assert image.moderation_status == CourseImageModeration.APPROVED


def test_a_provider_failure_counts_an_attempt_and_stays_retryable(session: Session) -> None:
    _reference_course(session)
    image = _photo(session, _course(session))
    client, _ = _client(gemini_status=500)

    _score(session, _settings(), image, client)

    assert image.quality_score is None
    # scored_at stays NULL so the sweeper reclaims it; attempts is what
    # eventually stops it retrying forever.
    assert image.scored_at is None
    assert image.scoring_attempts == 1
    assert image.moderation_status == CourseImageModeration.PENDING


def test_an_unfetchable_image_counts_an_attempt_and_stays_retryable(session: Session) -> None:
    """A 404 here is usually CDN propagation lag on an object promoted moments
    ago, not a permanently broken photo."""
    _reference_course(session)
    image = _photo(session, _course(session))
    client, _ = _client(candidate_image_status=404)

    _score(session, _settings(), image, client)

    assert image.scored_at is None
    assert image.scoring_attempts == 1


# --- what gets skipped ----------------------------------------------------


def test_an_already_scored_photo_is_skipped_without_any_request(session: Session) -> None:
    from datetime import datetime, timezone

    _reference_course(session)
    settings = _settings()
    image = _photo(session, _course(session), scored_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    client, seen = _client()
    references = load_reference_images(session, settings, client, use_cache=False)
    seen.clear()

    score_and_moderate_image(session, settings, image.id, client=client, reference_images=references)

    assert seen == []


def test_a_photo_at_the_attempt_ceiling_is_skipped(session: Session) -> None:
    settings = _settings(course_photo_scoring_max_attempts=3)
    image = _photo(session, _course(session), attempts=3)

    assert should_score(session, settings, image) is False


def test_photos_are_skipped_while_the_courses_hero_is_locked(session: Session) -> None:
    """is_hero outranks every score, so scoring here could not change which
    photo wins -- and scored_at stays NULL so the sweeper reclaims it later."""
    _reference_course(session)
    settings = _settings()
    course = _course(session)
    _photo(session, course, status=CourseImageModeration.APPROVED, is_hero=True)
    candidate = _photo(session, course)

    assert should_score(session, settings, candidate) is False

    client, seen = _client()
    references = load_reference_images(session, settings, client, use_cache=False)
    seen.clear()
    score_and_moderate_image(session, settings, candidate.id, client=client, reference_images=references)

    assert seen == []
    assert candidate.scored_at is None


def test_unfeaturing_the_hero_makes_the_photo_scoreable_again(session: Session) -> None:
    _reference_course(session)
    settings = _settings()
    course = _course(session)
    hero = _photo(session, course, status=CourseImageModeration.APPROVED, is_hero=True)
    candidate = _photo(session, course)

    CourseImageRepository().set_featured(session, hero, False)

    assert should_score(session, settings, candidate) is True


def test_non_user_and_non_pending_photos_are_never_scored(session: Session) -> None:
    settings = _settings()
    course = _course(session)

    wikimedia = _photo(session, course, source_type=CourseImageSource.WIKIMEDIA,
                       status=CourseImageModeration.APPROVED)
    approved_user = _photo(session, course, status=CourseImageModeration.APPROVED)
    rejected_user = _photo(session, course, status=CourseImageModeration.REJECTED)

    assert should_score(session, settings, wikimedia) is False
    assert should_score(session, settings, approved_user) is False
    assert should_score(session, settings, rejected_user) is False


def test_scoring_is_skipped_when_no_reference_images_resolve(session: Session) -> None:
    # No reference course exists, so there is nothing to prime the model with.
    settings = _settings()
    image = _photo(session, _course(session))
    client, seen = _client()

    references = load_reference_images(session, settings, client, use_cache=False)
    seen.clear()
    score_and_moderate_image(session, settings, image.id, client=client, reference_images=references)

    assert references == []
    assert seen == []
    assert image.scored_at is None


def test_run_scoring_task_never_raises(session: Session) -> None:
    """The BackgroundTask has nobody to report to, so any failure -- here, a
    missing session factory -- must stay contained."""
    class _App:
        class state:
            settings = _settings()

    run_scoring_task(_App(), 1)


def test_a_rejected_image_is_marked_permanently_failed(session: Session) -> None:
    """A 400 means the provider rejected this specific image -- a corrupt
    upload, say -- and will reject it identically forever. Marking scored_at
    stops it consuming an attempt on every future sweep."""
    _reference_course(session)
    image = _photo(session, _course(session))
    client, _ = _client(gemini_status=400)

    _score(session, _settings(), image, client)

    assert image.quality_score is None
    assert image.scored_at is not None
    assert image.scoring_attempts == 1
    assert should_score(session, _settings(), image) is False


def test_a_rate_limited_response_stays_retryable(session: Session) -> None:
    """429 is a 4xx but explicitly transient."""
    _reference_course(session)
    image = _photo(session, _course(session))
    client, _ = _client(gemini_status=429)

    _score(session, _settings(), image, client)

    assert image.scored_at is None
    assert should_score(session, _settings(), image) is True


def test_permanent_failure_classification() -> None:
    from app.course_photo_scoring_job import is_permanent_scoring_failure

    def status_error(code: int) -> httpx.HTTPStatusError:
        request = httpx.Request("POST", "https://example.test")
        return httpx.HTTPStatusError(
            "boom", request=request, response=httpx.Response(code, request=request)
        )

    assert is_permanent_scoring_failure(status_error(400)) is True
    assert is_permanent_scoring_failure(status_error(404)) is True
    assert is_permanent_scoring_failure(status_error(429)) is False
    assert is_permanent_scoring_failure(status_error(500)) is False
    assert is_permanent_scoring_failure(httpx.ConnectError("down")) is False
