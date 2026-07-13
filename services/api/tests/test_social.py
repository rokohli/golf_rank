from fastapi.testclient import TestClient

from app.main import create_app


def _profile(client: TestClient, subject: str, first_name: str, username: str) -> dict[str, str]:
    headers = {"X-Development-Subject": subject}
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 700,
            "difficulty": "any",
            "access": "any",
            "onboarding_data": {
                "first_name": first_name,
                "last_name": "Golfer",
                "username": username,
                "home_course_search": "Pebble Beach",
                "travel_distance": "Any",
                "preferred_tee_time": "Morning",
            },
        },
    )
    assert response.status_code == 200
    return headers


def test_feed_enforces_public_friends_and_private_visibility() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:social-alice", "Alice", "alice")
    bob = _profile(client, "dev:social-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "alice"}).json()[0]["id"]

    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={"course_id": 1, "played_on": "2026-07-01", "score": 80, "visibility": "friends"},
    )
    assert client.get("/api/v1/feed", headers=alice).json() == []

    client.put(f"/api/v1/me/follows/{alice_id}", headers=bob)
    mutual_feed = client.get("/api/v1/feed", headers=alice).json()
    assert mutual_feed[0]["event_type"] == "round_logged"
    assert mutual_feed[0]["data"]["score"] == 80
    assert "note" not in mutual_feed[0]["data"]

    client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={"course_id": 2, "played_on": "2026-07-02", "visibility": "private"},
    )
    feed = client.get("/api/v1/feed", headers=alice).json()
    assert all(item["course"]["id"] != 2 for item in feed)


def test_user_search_does_not_expose_provider_subjects() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:search-alice", "Alice", "alice")
    _profile(client, "dev:search-bob", "Bob", "bob")
    result = client.get("/api/v1/users", headers=alice, params={"q": "bob"})
    assert result.status_code == 200
    assert "provider_subject" not in result.json()[0]
