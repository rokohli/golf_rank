from app.db import make_engine, make_session_factory
from app.models import Base, Course, CourseImage, CourseImageModeration, CourseImageSource
from scripts.backfill_openverse_photos import courses_missing_photos_by_id


def make_course(session, **overrides) -> Course:
    defaults = dict(name="Wikimedia Only Links", region="Somewhere, CA", latitude=1.0, longitude=2.0)
    defaults.update(overrides)
    course = Course(**defaults)
    session.add(course)
    session.commit()
    return course


def make_session():
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)()


def test_a_wikimedia_only_course_is_still_targeted():
    """The whole point of Openverse as a higher-priority tier is to upgrade
    courses currently only served by Wikimedia -- unlike the Wikimedia
    backfill script, this one must NOT treat a Wikimedia row as coverage."""
    with make_session() as session:
        course = make_course(session)
        session.add(CourseImage(
            course_id=course.id, external_url="https://example.com/wiki.jpg",
            source_type=CourseImageSource.WIKIMEDIA, moderation_status=CourseImageModeration.APPROVED,
            position=0,
        ))
        session.commit()

        targeted = courses_missing_photos_by_id(session, 10, base_url_configured=False)

        assert [row.id for row in targeted] == [course.id]


def test_a_course_with_an_approved_openverse_photo_is_not_targeted():
    with make_session() as session:
        course = make_course(session)
        session.add(CourseImage(
            course_id=course.id, external_url="https://example.com/ov.jpg",
            source_type=CourseImageSource.OPENVERSE, moderation_status=CourseImageModeration.APPROVED,
            position=0,
        ))
        session.commit()

        assert courses_missing_photos_by_id(session, 10, base_url_configured=False) == []


def test_a_course_with_an_approved_official_photo_is_not_targeted():
    with make_session() as session:
        course = make_course(session)
        session.add(CourseImage(
            course_id=course.id, external_url="https://example.com/official.jpg",
            source_type=CourseImageSource.OFFICIAL, moderation_status=CourseImageModeration.APPROVED,
            position=0,
        ))
        session.commit()

        assert courses_missing_photos_by_id(session, 10, base_url_configured=False) == []


def test_a_pending_review_band_openverse_row_does_not_count_as_coverage():
    """A PENDING Openverse review candidate isn't an approved hero -- the
    course should still be re-checked on the next backfill run."""
    with make_session() as session:
        course = make_course(session)
        session.add(CourseImage(
            course_id=course.id, external_url="https://example.com/ov-pending.jpg",
            source_type=CourseImageSource.OPENVERSE, moderation_status=CourseImageModeration.PENDING,
            position=0,
        ))
        session.commit()

        assert [row.id for row in courses_missing_photos_by_id(session, 10, base_url_configured=False)] == [course.id]
