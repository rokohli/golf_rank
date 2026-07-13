from fastapi.testclient import TestClient

from app.main import create_app


HEADERS = {"X-Development-Subject": "dev:ranker"}


def test_tier_placements_create_an_ordered_ten_point_ranking() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={
            "assignments": [
                {"course_id": 1, "tier": "loved_it", "position": 1},
                {"course_id": 2, "tier": "loved_it", "position": 2},
                {"course_id": 3, "tier": "liked_it", "position": 1},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert [entry["course"]["id"] for entry in body["entries"]] == [1, 2, 3]
    assert [entry["personal_rating"] for entry in body["entries"]] == [10.0, 8.5, 7.7]
    assert all(1 <= entry["personal_rating"] <= 10 for entry in body["entries"])
    assert all("stars" not in entry for entry in body["entries"])


def test_decisive_comparison_reorders_within_tier_and_versions_snapshot() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "loved_it"},
            {"course_id": 2, "tier": "loved_it"},
        ]},
    )

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "course_b"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 2
    assert [entry["course"]["id"] for entry in body["entries"]] == [2, 1]
    assert all(entry["confidence"] == 0.5 for entry in body["entries"])

    fetched = client.get("/api/v1/me/rankings", headers=HEADERS)
    assert fetched.status_code == 200
    assert fetched.json()["version"] == 2
    assert fetched.json()["entries"] == body["entries"]


def test_uncertain_comparison_preserves_order_and_reduces_confidence() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "fine"},
            {"course_id": 2, "tier": "fine"},
        ]},
    )

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "not_sure"},
    )

    assert response.status_code == 200
    assert [entry["course"]["id"] for entry in response.json()["entries"]] == [1, 2]
    assert all(entry["confidence"] == 0.25 for entry in response.json()["entries"])


def test_comparison_requires_two_courses_in_the_same_tier() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "loved_it"},
            {"course_id": 2, "tier": "liked_it"},
        ]},
    )

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "course_a"},
    )

    assert response.status_code == 409


def test_ranking_is_private_to_the_current_user() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [{"course_id": 1, "tier": "loved_it"}]},
    )

    response = client.get(
        "/api/v1/me/rankings",
        headers={"X-Development-Subject": "dev:someone-else"},
    )

    assert response.status_code == 200
    assert response.json()["version"] == 0
    assert response.json()["entries"] == []


def test_not_sure_holds_course_outside_ranking_without_inventing_a_rating() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "loved_it"},
            {"course_id": 2, "tier": "not_sure"},
        ]},
    )

    assert response.status_code == 200
    assert [entry["course"]["id"] for entry in response.json()["entries"]] == [1]
    assert [course["id"] for course in response.json()["unranked_courses"]] == [2]


def test_single_course_tier_move_inserts_at_requested_position() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "loved_it"},
            {"course_id": 2, "tier": "loved_it"},
            {"course_id": 3, "tier": "loved_it"},
        ]},
    )

    response = client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [{"course_id": 3, "tier": "loved_it", "position": 1}]},
    )

    assert response.status_code == 200
    assert [entry["course"]["id"] for entry in response.json()["entries"]] == [3, 1, 2]
