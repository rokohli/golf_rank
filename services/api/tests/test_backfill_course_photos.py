from sqlalchemy import select

from app.db import make_engine, make_session_factory
from app.models import Base, Course, CourseImage, CourseImageModeration
from scripts.backfill_course_photos import courses_missing_photos_by_id


def make_course(session, **overrides) -> Course:
    defaults = dict(name="Rejected Photo Links", region="Somewhere, CA", latitude=1.0, longitude=2.0)
    defaults.update(overrides)
    course = Course(**defaults)
    session.add(course)
    session.commit()
    return course


def test_a_course_with_only_a_rejected_photo_is_still_targeted_by_backfill() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        course = make_course(session)
        session.add(CourseImage(
            course_id=course.id, external_url="https://example.com/rejected.jpg",
            moderation_status=CourseImageModeration.REJECTED, position=0,
        ))
        session.commit()

        targeted = courses_missing_photos_by_id(session, 10)

        assert [row.id for row in targeted] == [course.id]


def test_a_course_with_an_approved_photo_is_not_targeted_by_backfill() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        course = make_course(session)
        session.add(CourseImage(
            course_id=course.id, external_url="https://example.com/approved.jpg",
            moderation_status=CourseImageModeration.APPROVED, position=0,
        ))
        session.commit()

        targeted = courses_missing_photos_by_id(session, 10)

        assert targeted == []
