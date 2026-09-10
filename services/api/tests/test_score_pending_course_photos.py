from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.course_images.repository import CourseImageRepository
from app.db import make_engine, make_session_factory
from app.models import (
    Base,
    Course,
    CourseImage,
    CourseImageModeration,
    CourseImageModerationAction,
    CourseImageSource,
    User,
)
from scripts.score_pending_course_photos import (
    main,
    photos_to_score,
    reset_for_rescore,
)

SCORED_AT = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture()
def session() -> Session:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    with make_session_factory(engine, course_image_base_url="https://cdn.example")() as db_session:
        yield db_session


def _settings(**overrides) -> Settings:
    base = dict(
        wikimedia_live_lookup_enabled=False,
        course_image_base_url="https://cdn.example",
        gemini_api_key="test-key",
    )
    base.update(overrides)
    return Settings(**base)


def _course(session: Session, name: str = "Course") -> Course:
    course = Course(name=name, region="CA", latitude=37.0, longitude=-122.0)
    session.add(course)
    session.commit()
    return course


def _photo(session: Session, course: Course, *, key: str,
           status: str = CourseImageModeration.PENDING,
           source_type: str = CourseImageSource.USER,
           action: str | None = None,
           moderated_by_user_id: int | None = None,
           scored_at=None, attempts: int = 0, is_hero: bool = False) -> CourseImage:
    image = CourseImage(
        course_id=course.id, storage_key=key,
        position=CourseImageRepository().next_position(session, course.id),
        is_hero=is_hero, source_type=source_type, moderation_status=status,
        moderation_action=action, moderated_by_user_id=moderated_by_user_id,
        scored_at=scored_at, scoring_attempts=attempts,
    )
    session.add(image)
    session.commit()
    return image


def test_selects_only_unscored_pending_user_photos(session: Session) -> None:
    course = _course(session)
    wanted = _photo(session, course, key="a.jpg")
    _photo(session, course, key="scored.jpg", scored_at=SCORED_AT)
    _photo(session, course, key="approved.jpg", status=CourseImageModeration.APPROVED)
    _photo(session, course, key="rejected.jpg", status=CourseImageModeration.REJECTED)
    _photo(session, course, key="wiki.jpg", source_type=CourseImageSource.WIKIMEDIA,
           status=CourseImageModeration.APPROVED)

    selected, skipped = photos_to_score(session, _settings())

    assert [image.id for image in selected] == [wanted.id]
    assert skipped == 0


def test_skips_photos_at_the_attempt_ceiling(session: Session) -> None:
    course = _course(session)
    _photo(session, course, key="exhausted.jpg", attempts=3)

    selected, _ = photos_to_score(session, _settings(course_photo_scoring_max_attempts=3))

    assert selected == []


def test_skips_courses_whose_hero_is_locked(session: Session) -> None:
    locked = _course(session, "Locked")
    _photo(session, locked, key="hero.jpg", status=CourseImageModeration.APPROVED, is_hero=True)
    _photo(session, locked, key="skipped.jpg")
    open_course = _course(session, "Open")
    wanted = _photo(session, open_course, key="wanted.jpg")

    selected, skipped = photos_to_score(session, _settings())

    assert [image.id for image in selected] == [wanted.id]
    assert skipped == 1


def test_respects_limit_and_course_ids(session: Session) -> None:
    first_course = _course(session, "First")
    second_course = _course(session, "Second")
    first = _photo(session, first_course, key="a.jpg")
    _photo(session, first_course, key="b.jpg")
    _photo(session, second_course, key="c.jpg")

    limited, _ = photos_to_score(session, _settings(), limit=1)
    assert [image.id for image in limited] == [first.id]

    scoped, _ = photos_to_score(session, _settings(), course_ids=[second_course.id])
    assert [image.course_id for image in scoped] == [second_course.id]


def test_rescore_reselects_already_scored_photos(session: Session) -> None:
    course = _course(session)
    already = _photo(session, course, key="scored.jpg", scored_at=SCORED_AT)

    default_run, _ = photos_to_score(session, _settings())
    assert default_run == []

    rescored, _ = photos_to_score(session, _settings(), rescore=True, course_ids=[course.id])
    assert [image.id for image in rescored] == [already.id]


def test_rescore_includes_auto_approved_photos_without_moderator(session: Session) -> None:
    mod = User(provider_subject="mod_1")
    session.add(mod)
    session.commit()

    course = _course(session)
    auto_approved = _photo(
        session, course, key="auto.jpg",
        status=CourseImageModeration.APPROVED,
        action=CourseImageModerationAction.AUTO_APPROVED,
        moderated_by_user_id=None,
        scored_at=SCORED_AT,
    )
    human_approved = _photo(
        session, course, key="human.jpg",
        status=CourseImageModeration.APPROVED,
        action=CourseImageModerationAction.APPROVED,
        moderated_by_user_id=mod.id,
        scored_at=SCORED_AT,
    )
    human_featured = _photo(
        session, course, key="featured.jpg",
        status=CourseImageModeration.APPROVED,
        action=CourseImageModerationAction.FEATURED,
        moderated_by_user_id=mod.id,
        scored_at=SCORED_AT,
    )
    human_rejected = _photo(
        session, course, key="rejected.jpg",
        status=CourseImageModeration.REJECTED,
        action=CourseImageModerationAction.REJECTED,
        moderated_by_user_id=mod.id,
    )
    pending_photo = _photo(session, course, key="pending.jpg", scored_at=SCORED_AT)

    # In default run, neither auto_approved nor human_approved nor already scored pending is selected
    default_run, _ = photos_to_score(session, _settings())
    assert default_run == []

    # In rescore run, auto_approved and pending are included, but human-moderated photos are excluded
    rescored, _ = photos_to_score(session, _settings(), rescore=True, course_ids=[course.id])
    rescored_ids = {image.id for image in rescored}
    assert auto_approved.id in rescored_ids
    assert pending_photo.id in rescored_ids
    assert human_approved.id not in rescored_ids
    assert human_featured.id not in rescored_ids
    assert human_rejected.id not in rescored_ids


def test_rescore_resets_auto_approved_status_and_clears_prior_results(session: Session) -> None:
    course = _course(session)
    auto_approved = _photo(
        session, course, key="auto.jpg",
        status=CourseImageModeration.APPROVED,
        action=CourseImageModerationAction.AUTO_APPROVED,
        moderated_by_user_id=None,
        scored_at=SCORED_AT,
        attempts=2,
    )
    auto_approved.quality_score = 9.0
    auto_approved.quality_score_reasons = ["crisp framing"]
    pending_photo = _photo(
        session, course, key="pending.jpg",
        status=CourseImageModeration.PENDING,
        scored_at=SCORED_AT,
        attempts=3,
    )
    pending_photo.quality_score = 6.0
    pending_photo.quality_score_reasons = ["grainy"]
    session.commit()

    reset_for_rescore(session, auto_approved.id)
    reset_for_rescore(session, pending_photo.id)

    session.refresh(auto_approved)
    session.refresh(pending_photo)

    assert auto_approved.moderation_status == CourseImageModeration.PENDING
    assert auto_approved.moderation_action is None
    assert auto_approved.moderated_at is None
    assert auto_approved.moderation_reason is None
    assert auto_approved.scored_at is None
    assert auto_approved.scoring_attempts == 0
    assert auto_approved.quality_score is None
    assert auto_approved.quality_score_reasons is None

    assert pending_photo.moderation_status == CourseImageModeration.PENDING
    assert pending_photo.scored_at is None
    assert pending_photo.scoring_attempts == 0
    assert pending_photo.quality_score is None
    assert pending_photo.quality_score_reasons is None


def test_rescore_does_not_reset_human_moderated_photo(session: Session) -> None:
    mod = User(provider_subject="mod_safety")
    session.add(mod)
    session.commit()

    course = _course(session)
    human_approved = _photo(
        session, course, key="human.jpg",
        status=CourseImageModeration.APPROVED,
        action=CourseImageModerationAction.APPROVED,
        moderated_by_user_id=mod.id,
        scored_at=SCORED_AT,
    )
    human_approved.quality_score = 9.0
    session.commit()

    # Attempting to reset a human-moderated row returns False and changes nothing
    reset_ok = reset_for_rescore(session, human_approved.id)
    assert reset_ok is False

    session.refresh(human_approved)
    assert human_approved.moderation_status == CourseImageModeration.APPROVED
    assert human_approved.moderation_action == CourseImageModerationAction.APPROVED
    assert human_approved.moderated_by_user_id == mod.id
    assert human_approved.quality_score == 9.0


def test_rescore_does_not_demote_if_references_fail(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course(session)
    auto_approved = _photo(
        session, course, key="auto.jpg",
        status=CourseImageModeration.APPROVED,
        action=CourseImageModerationAction.AUTO_APPROVED,
        moderated_by_user_id=None,
        scored_at=SCORED_AT,
    )
    auto_approved.quality_score = 9.0
    session.commit()

    from contextlib import contextmanager

    @contextmanager
    def fake_session():
        yield session

    monkeypatch.setattr("scripts.score_pending_course_photos.make_session_factory", lambda *a, **kw: fake_session)
    monkeypatch.setattr("scripts.score_pending_course_photos.load_reference_images", lambda *a, **kw: [])
    monkeypatch.setattr("scripts.score_pending_course_photos.Settings", lambda: _settings())
    monkeypatch.setattr("sys.argv", ["score_pending_course_photos", "--rescore", "--course-ids", str(course.id)])

    exit_code = main()
    assert exit_code == 1

    session.refresh(auto_approved)
    assert auto_approved.moderation_status == CourseImageModeration.APPROVED
    assert auto_approved.moderation_action == CourseImageModerationAction.AUTO_APPROVED
    assert auto_approved.quality_score == 9.0


def test_rescore_without_course_ids_exits_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unscoped, --rescore would re-spend a provider call on the whole backlog."""
    monkeypatch.setattr("sys.argv", ["score_pending_course_photos", "--rescore"])

    assert main() == 1


def test_rescore_with_empty_or_whitespace_course_ids_exits_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    """A syntactically present but empty course scope like ',' or whitespace must not bypass the scope requirement."""
    monkeypatch.setattr("sys.argv", ["score_pending_course_photos", "--rescore", "--course-ids", ","])
    assert main() == 1

    monkeypatch.setattr("sys.argv", ["score_pending_course_photos", "--rescore", "--course-ids", "   "])
    assert main() == 1


def test_invalid_course_ids_format_exits_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-integer tokens in --course-ids must be rejected cleanly."""
    monkeypatch.setattr("sys.argv", ["score_pending_course_photos", "--course-ids", "abc,123"])
    assert main() == 1


def test_exits_nonzero_without_a_gemini_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.argv", ["score_pending_course_photos"])
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    assert main() == 1


def test_rescore_recovers_a_photo_stranded_by_transient_failures(session: Session) -> None:
    """claim_for_scoring spends an attempt *before* the provider call, so a few
    transient failures -- a brief provider outage, CDN lag on a just-promoted
    object -- can exhaust the budget on a photo that was never actually scored.
    The normal sweep must still respect the ceiling, but --rescore has to be
    able to reach those photos or manual SQL is the only recovery."""
    course = _course(session)
    stranded = _photo(session, course, key="stranded.jpg", attempts=3)

    normal, _ = photos_to_score(session, _settings(course_photo_scoring_max_attempts=3))
    assert normal == []

    recovered, _ = photos_to_score(
        session, _settings(course_photo_scoring_max_attempts=3),
        rescore=True, course_ids=[course.id],
    )
    assert [image.id for image in recovered] == [stranded.id]


def test_photos_to_score_applies_sql_limit_without_n_plus_one(session: Session) -> None:
    """Verifies Finding 4: photos_to_score applies limit and hero check directly in SQL
    without materializing full backlogs or executing N+1 queries."""
    from sqlalchemy import event
    engine = session.get_bind()

    # Create 10 courses and photos
    for i in range(10):
        course = _course(session, f"Course {i}")
        _photo(session, course, key=f"photo_{i}.jpg")

    queries = []

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        selected, skipped = photos_to_score(session, _settings(), limit=3)
        assert len(selected) == 3
        assert skipped == 0
        # Exactly 2 queries: one COUNT(*) for skipped and one SELECT ... LIMIT 3 for selected
        assert len(queries) == 2, f"Expected exactly 2 queries, got {len(queries)}: {queries}"
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
