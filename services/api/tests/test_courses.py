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


def test_course_search_combines_normalized_region_radius_and_stable_cursor() -> None:
    client = TestClient(create_app())
    nearby = client.get(
        "/api/v1/courses",
        params={"country": "US", "admin1": "CA", "lat": 36.568, "lng": -121.949, "radius_miles": 5, "limit": 1},
    )
    assert nearby.status_code == 200
    assert len(nearby.json()) == 1
    first_id = nearby.json()[0]["id"]
    next_page = client.get("/api/v1/courses", params={"admin1": "CA", "cursor": first_id, "limit": 10})
    assert all(course["id"] > first_id for course in next_page.json())


def test_course_regions_and_missing_course_submission() -> None:
    client = TestClient(create_app())
    regions = client.get("/api/v1/course-regions")
    assert regions.status_code == 200
    assert any(item["city"] == "Monterey" and item["course_count"] == 2 for item in regions.json()["regions"])

    headers = {"X-Development-Subject": "dev:catalog-user"}
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={"home_region": "Monterey, CA", "max_green_fee": 700, "difficulty": "any", "access": "any"},
    )
    submitted = client.post(
        "/api/v1/course-candidates",
        headers=headers,
        json={"name": "Missing Links", "city": "Carmel", "admin1_code": "ca"},
    )
    assert submitted.status_code == 201
    assert submitted.json()["status"] == "pending"
    assert submitted.json()["admin1_code"] == "CA"
