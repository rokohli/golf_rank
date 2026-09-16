from datetime import date, datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.course_images.repository import CourseImageRepository
from app.course_images.service import CourseImageService
from app.core.config import Settings
from app.db import make_engine, make_session_factory
from app.models import Base, Course, CourseImage, CourseImageModeration, CourseImageSource, Round, User


@pytest.fixture()
def session() -> Session:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine)
    with factory() as db_session:
        yield db_session


def make_course(session: Session) -> Course:
    course = Course(name="Pasatiempo Golf Club", region="Santa Cruz, CA", latitude=37.004, longitude=-121.998)
    session.add(course)
    session.commit()
    return course


def make_user(session: Session, provider_subject: str = "dev:test-uploader") -> User:
    user = User(provider_subject=provider_subject)
    session.add(user)
    session.commit()
    return user


def test_add_user_image_sets_pending_user_fields(session: Session) -> None:
    course = make_course(session)
    user = make_user(session)
    repository = CourseImageRepository()

    image = repository.add_user_image(
        session, course.id,
        storage_key="course-photos/1/abc.jpg",
        uploaded_by_user_id=user.id,
        alt_text="User-submitted photo of Pasatiempo Golf Club",
        width=1600,
        height=1200,
    )

    assert image.source_type == CourseImageSource.USER
    assert image.moderation_status == CourseImageModeration.PENDING
    assert image.is_hero is False
    assert image.storage_key == "course-photos/1/abc.jpg"
    assert image.external_url is None
    assert image.uploaded_by_user_id == user.id
    assert image.width == 1600
    assert image.height == 1200
    assert image.id is not None
    assert image.created_at is not None


def test_add_user_image_increments_position(session: Session) -> None:
    course = make_course(session)
    user = make_user(session)
    repository = CourseImageRepository()

    first = repository.add_user_image(session, course.id, storage_key="course-photos/1/a.jpg", uploaded_by_user_id=user.id)
    second = repository.add_user_image(session, course.id, storage_key="course-photos/1/b.jpg", uploaded_by_user_id=user.id)

    assert second.position == first.position + 1


def test_add_user_image_retries_on_position_race(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """A concurrent upload can commit between this call's next_position() read
    and its own insert, colliding on uq_course_image_position -- add_user_image
    must retry with a fresh position rather than surface the IntegrityError."""
    course = make_course(session)
    user = make_user(session)
    repository = CourseImageRepository()

    session.add(CourseImage(
        course_id=course.id, storage_key="course-photos/1/first.jpg", position=0,
        source_type=CourseImageSource.USER, moderation_status=CourseImageModeration.PENDING,
        uploaded_by_user_id=user.id,
    ))
    session.commit()

    real_next_position = repository.next_position
    calls = {"count": 0}

    def stale_then_real(sess: Session, course_id: int) -> int:
        calls["count"] += 1
        # First read is stale (as if it ran before the concurrent commit above
        # actually landed); every retry after that sees the real, current max.
        return 0 if calls["count"] == 1 else real_next_position(sess, course_id)

    monkeypatch.setattr(repository, "next_position", stale_then_real)

    image = repository.add_user_image(session, course.id, storage_key="course-photos/1/second.jpg", uploaded_by_user_id=user.id)

    assert image.position == 1
    assert calls["count"] == 2


def make_round(session: Session, course: Course, user: User) -> Round:
    round_ = Round(user_id=user.id, course_id=course.id, played_on=date(2026, 7, 1))
    session.add(round_)
    session.commit()
    return round_


def test_add_user_image_links_round_id_and_counts_for_round(session: Session) -> None:
    course = make_course(session)
    user = make_user(session)
    round_ = make_round(session, course, user)
    repository = CourseImageRepository()

    image = repository.add_user_image(
        session, course.id,
        storage_key="course-photos/1/round.jpg",
        uploaded_by_user_id=user.id,
        round_id=round_.id,
    )

    assert image.round_id == round_.id
    assert repository.count_for_round(session, round_.id) == 1

    other_round = make_round(session, course, user)
    assert repository.count_for_round(session, other_round.id) == 0


def test_pending_user_upload_ineligible_as_hero_until_approved(session: Session) -> None:
    """Moderation gates hero-image eligibility only: a fresh PENDING USER row
    from add_user_image is ignored by resolve_hero_image until moderation
    flips it to APPROVED -- it does not need to be hidden from the gallery."""
    course = make_course(session)
    user = make_user(session)
    repository = CourseImageRepository()
    settings = Settings(wikimedia_live_lookup_enabled=False, course_image_base_url="https://cdn.example/assets")
    service = CourseImageService(settings=settings)

    image = repository.add_user_image(session, course.id, storage_key="course-photos/1/a.jpg", uploaded_by_user_id=user.id)

    assert service.resolve_hero_image(session, course).type == "NONE"

    image.moderation_status = CourseImageModeration.APPROVED
    session.commit()

    assert service.resolve_hero_image(session, course).type == "USER"


def _approved_user_image(
    session: Session, course: Course, *, key: str, score: float | None,
    created_at: datetime, is_hero: bool = False,
) -> CourseImage:
    image = CourseImage(
        course_id=course.id,
        storage_key=key,
        position=CourseImageRepository().next_position(session, course.id),
        is_hero=is_hero,
        source_type=CourseImageSource.USER,
        moderation_status=CourseImageModeration.APPROVED,
        quality_score=score,
        width=1600,
        height=900,
        created_at=created_at,
    )
    session.add(image)
    session.commit()
    return image


def test_equal_scores_keep_the_incumbent_hero(session: Session) -> None:
    """The scorer emits integers, so ties are common. Newest-first would rotate
    the hero to the most recent equally-scored upload every time one landed --
    churn with no gain in quality. The older row must win."""
    course = make_course(session)
    older = _approved_user_image(
        session, course, key="older.jpg", score=8.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    _approved_user_image(
        session, course, key="newer.jpg", score=8.0,
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )

    ranked = CourseImageRepository().approved_images(session, course.id, CourseImageSource.USER)

    assert ranked[0].id == older.id


def test_a_strictly_higher_score_still_displaces_the_incumbent(session: Session) -> None:
    course = make_course(session)
    _approved_user_image(
        session, course, key="older.jpg", score=8.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    better = _approved_user_image(
        session, course, key="newer.jpg", score=9.0,
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )

    ranked = CourseImageRepository().approved_images(session, course.id, CourseImageSource.USER)

    assert ranked[0].id == better.id


def test_a_featured_photo_outranks_a_higher_scoring_one(session: Session) -> None:
    """is_hero is the first term: a human's explicit pick is not displaced by
    any score, which is what makes auto-approval safe to leave is_hero alone."""
    course = make_course(session)
    featured = _approved_user_image(
        session, course, key="featured.jpg", score=2.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc), is_hero=True,
    )
    _approved_user_image(
        session, course, key="high.jpg", score=10.0,
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )

    ranked = CourseImageRepository().approved_images(session, course.id, CourseImageSource.USER)

    assert ranked[0].id == featured.id


def test_has_featured_hero_only_counts_official_and_user_tiers(session: Session) -> None:
    course = make_course(session)
    repository = CourseImageRepository()

    assert repository.has_featured_hero(session, course.id) is False

    # add_wikimedia_image sets is_hero unconditionally on every cached row, so
    # counting that tier would report nearly every course as locked.
    repository.add_wikimedia_image(
        session, course.id, external_url="https://commons.example/a.jpg",
        thumbnail_url="https://commons.example/a.jpg", alt_text="a",
        source_name=None, source_url=None, license_name=None, license_url=None,
        width=1600, height=900,
    )
    assert repository.has_featured_hero(session, course.id) is False

    _approved_user_image(
        session, course, key="user.jpg", score=8.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc), is_hero=True,
    )
    assert repository.has_featured_hero(session, course.id) is True


def test_has_featured_hero_is_false_for_approved_but_unfeatured(session: Session) -> None:
    course = make_course(session)
    _approved_user_image(
        session, course, key="user.jpg", score=8.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc), is_hero=False,
    )

    assert CourseImageRepository().has_featured_hero(session, course.id) is False


def test_add_openverse_image_sets_approved_and_auto_approved(session: Session) -> None:
    course = make_course(session)
    repo = CourseImageRepository()

    image = repo.add_openverse_image(
        session, course.id,
        external_url="https://example.com/ov.jpg", thumbnail_url="https://example.com/ov-thumb.jpg",
        alt_text="alt", source_name="Flickr", source_url="https://flickr.com/x",
        license_name="BY-SA", license_url="https://creativecommons.org/licenses/by-sa/4.0/",
        width=2000, height=1200, provider_asset_id="asset-1", creator_name="Jane",
        creator_url="https://example.com/jane", match_confidence_score=85,
        match_score_reasons=["+50 exact match"], matched_query="q",
    )

    assert image.source_type == CourseImageSource.OPENVERSE
    assert image.moderation_status == CourseImageModeration.APPROVED
    assert image.is_hero is True
    assert image.moderation_action == "auto_approved"
    assert image.provider_asset_id == "asset-1"


def test_add_openverse_review_candidate_is_pending_not_hero(session: Session) -> None:
    course = make_course(session)
    repo = CourseImageRepository()

    image = repo.add_openverse_review_candidate(
        session, course.id,
        external_url="https://example.com/ov.jpg", thumbnail_url=None,
        alt_text="alt", source_name="Flickr", source_url=None,
        license_name="BY", license_url=None,
        width=1600, height=1000, provider_asset_id="asset-2", creator_name=None,
        creator_url=None, match_confidence_score=55, match_score_reasons=["+30"], matched_query="q",
    )

    assert image.moderation_status == CourseImageModeration.PENDING
    assert image.is_hero is False

    # never eligible as the resolver's hero while pending
    assert repo.best_openverse_image(session, course.id) is None


def test_find_openverse_image_by_asset_dedupes_reruns(session: Session) -> None:
    course = make_course(session)
    repo = CourseImageRepository()
    repo.add_openverse_review_candidate(
        session, course.id,
        external_url="https://example.com/ov.jpg", thumbnail_url=None, alt_text="alt",
        source_name=None, source_url=None, license_name="BY", license_url=None,
        width=1600, height=1000, provider_asset_id="asset-dupe", creator_name=None,
        creator_url=None, match_confidence_score=55, match_score_reasons=[], matched_query="q",
    )

    assert repo.find_openverse_image_by_asset(session, course.id, "asset-dupe") is not None
    assert repo.find_openverse_image_by_asset(session, course.id, "asset-missing") is None


def test_sibling_course_names_scoped_to_shared_facility(session: Session) -> None:
    repo = CourseImageRepository()
    black = Course(
        name="Bethpage Black", facility_name="Bethpage State Park", course_name="Bethpage Black",
        region="Farmingdale, NY", latitude=40.74, longitude=-73.46,
    )
    green = Course(
        name="Bethpage Green", facility_name="Bethpage State Park", course_name="Bethpage Green",
        region="Farmingdale, NY", latitude=40.74, longitude=-73.46,
    )
    unrelated = Course(name="Some Other Course", region="Elsewhere, NY", latitude=1.0, longitude=1.0)
    session.add_all([black, green, unrelated])
    session.commit()

    siblings = repo.sibling_course_names(session, black)
    assert siblings == ["Bethpage Green"]
    assert repo.sibling_course_names(session, unrelated) == []


def test_moderation_queue_defaults_to_user_only(session: Session) -> None:
    course = make_course(session)
    repo = CourseImageRepository()
    session.add_all([
        CourseImage(
            course_id=course.id, external_url="https://example.com/ov.jpg", position=0,
            source_type=CourseImageSource.OPENVERSE, moderation_status=CourseImageModeration.PENDING,
        ),
        CourseImage(
            course_id=course.id, storage_key="user/1.jpg", position=1,
            source_type=CourseImageSource.USER, moderation_status=CourseImageModeration.PENDING,
        ),
    ])
    session.commit()

    default_queue = repo.moderation_queue(session, status=CourseImageModeration.PENDING)
    assert [img.source_type for img in default_queue] == [CourseImageSource.USER]

    openverse_queue = repo.moderation_queue(
        session, status=CourseImageModeration.PENDING, source_types=(CourseImageSource.OPENVERSE,),
    )
    assert [img.source_type for img in openverse_queue] == [CourseImageSource.OPENVERSE]

    both_queue = repo.moderation_queue(
        session, status=CourseImageModeration.PENDING,
        source_types=(CourseImageSource.USER, CourseImageSource.OPENVERSE),
    )
    assert len(both_queue) == 2


def test_lock_image_for_moderation_filters_by_requested_source_types(session: Session) -> None:
    """lock_image_for_moderation is itself source-type-agnostic -- it returns
    whatever `source_types` the caller asks for. The OFFICIAL/WIKIMEDIA
    exclusion is enforced by the caller (course_photo_moderation.py's
    _MODERATABLE_SOURCE_TYPES constant only ever contains USER/OPENVERSE),
    not by this method -- see test_course_photo_moderation.py for that
    router-level guarantee."""
    course = make_course(session)
    repo = CourseImageRepository()
    official = CourseImage(
        course_id=course.id, external_url="https://example.com/official.jpg", position=0,
        source_type=CourseImageSource.OFFICIAL, moderation_status=CourseImageModeration.APPROVED,
    )
    session.add(official)
    session.commit()

    assert repo.lock_image_for_moderation(session, official.id) is None  # default is USER-only
    assert repo.lock_image_for_moderation(
        session, official.id, source_types=(CourseImageSource.OFFICIAL,),
    ) is not None
