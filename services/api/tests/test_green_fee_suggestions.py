from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import Course, CourseGreenFeeSuggestion


def _client() -> TestClient:
    app = create_app(Settings(wikimedia_live_lookup_enabled=False))
    return TestClient(app)


def _unpriced_course_id(client: TestClient, *, name: str = "Unpriced Links") -> int:
    app = client.app
    with app.state.session_factory() as session:
        course = Course(
            name=name, region="Nowhere, CA", latitude=1.0, longitude=1.0,
            is_public=True, green_fee=None, source="seed", source_course_id=name,
            country_code="US", admin1_code="CA", admin1_name="California",
        )
        session.add(course)
        session.commit()
        return course.id


def _headers(subject: str) -> dict[str, str]:
    return {"X-Development-Subject": f"dev:{subject}"}


def test_suggest_fee_requires_auth() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    response = client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 60})

    assert response.status_code == 401


def test_suggest_fee_404_for_missing_course() -> None:
    client = _client()

    response = client.post(
        "/api/v1/courses/999999/fee-suggestions", json={"suggested_fee": 60}, headers=_headers("a"),
    )

    assert response.status_code == 404


def test_suggest_fee_409_when_course_already_has_a_known_fee() -> None:
    client = _client()
    pebble_id = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]

    response = client.post(
        f"/api/v1/courses/{pebble_id}/fee-suggestions", json={"suggested_fee": 60}, headers=_headers("a"),
    )

    assert response.status_code == 409


def test_suggest_fee_rejects_out_of_range_values() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 0}, headers=_headers("a"),
    )

    assert response.status_code == 422


def test_single_suggestion_stays_pending_and_does_not_apply() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 60}, headers=_headers("a"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["applied"] is False
    assert body["course_green_fee"] is None


def test_two_agreeing_suggestions_apply_their_average() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 60}, headers=_headers("a"))
    response = client.post(
        f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 70}, headers=_headers("b"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["applied"] is True
    assert body["course_green_fee"] == 65

    app = client.app
    with app.state.session_factory() as session:
        course = session.get(Course, course_id)
        assert course.green_fee == 65


def test_disagreeing_suggestions_do_not_apply() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 40}, headers=_headers("a"))
    response = client.post(
        f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 150}, headers=_headers("b"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["applied"] is False
    assert body["course_green_fee"] is None


def test_resubmitting_updates_the_existing_suggestion_rather_than_duplicating() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 40}, headers=_headers("a"))
    client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 60}, headers=_headers("a"))

    app = client.app
    with app.state.session_factory() as session:
        rows = session.query(CourseGreenFeeSuggestion).filter_by(course_id=course_id).all()
        assert len(rows) == 1
        assert rows[0].suggested_fee == 60


def test_once_applied_a_further_suggestion_is_rejected() -> None:
    client = _client()
    course_id = _unpriced_course_id(client)

    client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 60}, headers=_headers("a"))
    client.post(f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 70}, headers=_headers("b"))

    response = client.post(
        f"/api/v1/courses/{course_id}/fee-suggestions", json={"suggested_fee": 65}, headers=_headers("c"),
    )

    assert response.status_code == 409
