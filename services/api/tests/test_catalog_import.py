import httpx
from sqlalchemy import select

from app.catalog_import import fetch_state_courses, import_courses, normalize_access, normalize_course_name, onboarding_states, state_code_from_region
from app.db import make_engine, make_session_factory
from app.models import Base, Course, Profile, User


def test_catalog_import_is_idempotent_nullable_and_soft_retires_missing_records() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    records = [{
        "id": "provider-1",
        "name": "Open Links",
        "course_name": "Open Links",
        "latitude": 34.1,
        "longitude": -118.2,
        "state": "CA",
        "city": "Los Angeles",
        "type": None,
        "holes": 18,
        "par": 71,
    }]
    with session_factory() as session:
        first = import_courses(session, records, state="CA")
        second = import_courses(
            session,
            [{key: value for key, value in records[0].items() if key not in {"holes", "par"}}],
            state="CA",
        )
        assert first.inserted == 1
        assert second.updated == 1
        stored = session.scalar(select(Course).where(Course.source_course_id == "provider-1"))
        assert stored is not None
        assert stored.green_fee is None
        assert stored.access is None
        assert stored.hole_count == 18
        assert stored.par == 71
        assert stored.tee_time_url is None

        retired = import_courses(session, [], state="CA")
        assert retired.retired == 1
        assert stored.status == "retired"


def test_catalog_dry_run_does_not_write_and_access_normalization_is_conservative() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        report = import_courses(session, [{
            "id": "provider-2", "name": "Private Links", "latitude": 34.0,
            "longitude": -118.0, "city": "Beverly Hills", "type": "Private",
        }], state="CA", dry_run=True)
        assert report.inserted == 1
        assert session.scalar(select(Course.id)) is None
    assert normalize_access("Public/Municipal") == ("public", True)
    assert normalize_access("Resort") == ("resort", None)


def test_catalog_fetch_uses_documented_v1_state_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/courses/state/CA"
        return httpx.Response(200, json={"courses": [{"id": "provider-1"}], "total": 1})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_state_courses("CA", client=client) == [{"id": "provider-1"}]


def test_catalog_import_can_derive_states_from_onboarding_regions() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        users = [User(provider_subject=f"dev:region-{index}") for index in range(3)]
        session.add_all(users)
        session.flush()
        session.add_all([
            Profile(user_id=users[0].id, home_region="Austin, TX"),
            Profile(user_id=users[1].id, home_region="Texas"),
            Profile(user_id=users[2].id, home_region="Portland, OR"),
        ])
        session.commit()

        assert onboarding_states(session) == ["OR", "TX"]

    assert state_code_from_region("Monterey, CA") == "CA"
    assert state_code_from_region("North Carolina") == "NC"
    assert state_code_from_region("London") is None


def test_catalog_import_removes_stripped_trademark_artifacts_from_course_names() -> None:
    assert normalize_course_name("Spyglass Hilltm Golf Course") == "Spyglass Hill Golf Course"
    assert normalize_course_name("The Haytm") == "The Hay"
    assert normalize_course_name("Timber Creek Golf Club") == "Timber Creek Golf Club"
