import httpx
from sqlalchemy import select

from app.catalog_import import fetch_state_courses, import_courses, normalize_access
from app.db import make_engine, make_session_factory
from app.models import Base, Course


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
    }]
    with session_factory() as session:
        first = import_courses(session, records, state="CA")
        second = import_courses(session, records, state="CA")
        assert first.inserted == 1
        assert second.updated == 1
        stored = session.scalar(select(Course).where(Course.source_course_id == "provider-1"))
        assert stored is not None
        assert stored.green_fee is None
        assert stored.access is None

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
