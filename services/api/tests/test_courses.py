from fastapi.testclient import TestClient

from app.main import create_app


def test_course_search_filters_by_region_fee_and_access() -> None:
    client = TestClient(create_app())
    response = client.get(
        "/api/v1/courses",
        params={"q": "Pebble", "region": "Monterey, CA", "max_green_fee": 700, "access": "public"},
    )

    assert response.status_code == 200
    assert [course["name"] for course in response.json()] == ["Pebble Beach Golf Links"]


def test_course_search_filters_by_difficulty() -> None:
    client = TestClient(create_app())
    response = client.get(
        "/api/v1/courses",
        params={"region": "Monterey, CA", "difficulty": "beginner"},
    )

    assert response.status_code == 200
    assert response.json() == []


def test_course_detail_resolves_a_course_by_id() -> None:
    client = TestClient(create_app())
    course_id = client.get("/api/v1/courses", params={"q": "Spyglass"}).json()[0]["id"]

    response = client.get(f"/api/v1/courses/{course_id}")

    assert response.status_code == 200
    assert response.json()["name"] == "Spyglass Hill Golf Course"


def test_course_detail_returns_not_found_for_unknown_id() -> None:
    client = TestClient(create_app())

    response = client.get("/api/v1/courses/999999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Course not found"}
