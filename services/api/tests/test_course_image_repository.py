from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.course_images.repository import CourseImageRepository
from app.course_images.service import CourseImageService
from app.core.config import Settings
from app.db import make_engine, make_session_factory
from app.models import Base, Course, CourseImageModeration, CourseImageSource, Round, User


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
