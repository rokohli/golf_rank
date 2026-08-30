from fastapi.testclient import TestClient

from app.main import create_app


def _onboard(client: TestClient, subject: str, username: str) -> None:
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": subject},
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 250,
            "difficulty": "any",
            "access": "any",
            "onboarding_data": {
                "first_name": username.title(),
                "last_name": "Golfer",
                "username": username,
                "home_course_id": "pebble",
                "home_course_search": "Pebble Beach Golf Links",
                "played_course_ids": [],
                "favorite_wins": [],
                "dream_course_ids": [],
                "preferences": [],
                "group_size": "Foursome",
                "budget": "$$$",
                "travel_distance": "Up to 45 minutes",
                "preferred_tee_time": "Weekend mornings",
                "transportation": "Cart",
                "notifications": True,
                "default_round_visibility": "friends",
            },
        },
    )
    assert response.status_code == 200, response.text


def test_deleting_one_user_does_not_break_the_other_users_social_data() -> None:
    """Cross-user regression: Alice's account deletion must not orphan or
    crash anything Bob can see (follow graph, feed, notifications, rounds).
    """
    client = TestClient(create_app())
    alice = {"X-Development-Subject": "dev:alice"}
    bob = {"X-Development-Subject": "dev:bob"}
    _onboard(client, "dev:alice", "alice")
    _onboard(client, "dev:bob", "bob")

    bob_id = client.get("/api/v1/users?q=bob", headers=alice).json()[0]["id"]
    alice_id = client.get("/api/v1/users?q=alice", headers=bob).json()[0]["id"]

    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert client.put(f"/api/v1/me/follows/{alice_id}", headers=bob).status_code == 200

    round_response = client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={"course_id": 1, "played_on": "2026-01-01", "friend_user_ids": [alice_id], "guest_names": []},
    )
    assert round_response.status_code == 201, round_response.text

    feed_before = client.get("/api/v1/feed", headers=alice).json()
    event_id = feed_before["items"][0]["id"]
    assert client.put(f"/api/v1/feed/{event_id}/reactions/like", headers=alice).status_code == 200

    notifications_before = client.get("/api/v1/me/notifications", headers=bob).json()
    assert any(item["actor"]["id"] == alice_id for item in notifications_before["items"])

    delete_response = client.delete("/api/v1/me", headers=alice)
    assert delete_response.status_code == 200

    # Bob's own data and every endpoint touching the (now-gone) relationship
    # must keep working -- no 500s, no dangling references to Alice.
    follows = client.get("/api/v1/me/follows", headers=bob)
    assert follows.status_code == 200
    assert follows.json() == []

    feed_after = client.get("/api/v1/feed", headers=bob)
    assert feed_after.status_code == 200
    assert all(item["actor"]["id"] != alice_id for item in feed_after.json()["items"])

    notifications_after = client.get("/api/v1/me/notifications", headers=bob)
    assert notifications_after.status_code == 200
    assert all(item["actor"]["id"] != alice_id for item in notifications_after.json()["items"])

    bobs_round = client.get("/api/v1/me/rounds", headers=bob)
    assert bobs_round.status_code == 200
    assert bobs_round.json()[0]["course"]["id"] == 1
    assert bobs_round.json()[0]["companions"] == []

    search_for_alice = client.get("/api/v1/users?q=alice", headers=bob)
    assert search_for_alice.status_code == 200
    assert search_for_alice.json() == []


def test_delete_account_removes_profile_and_dependent_rows() -> None:
    client = TestClient(create_app())
    headers = {"X-Development-Subject": "dev:alice"}
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 250,
            "difficulty": "challenging",
            "access": "public",
        },
    )

    response = client.delete("/api/v1/me", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}

    profile = client.get("/api/v1/me/profile", headers=headers)
    assert profile.status_code == 404


def test_delete_account_is_idempotent_when_no_local_account_exists() -> None:
    client = TestClient(create_app())
    response = client.delete("/api/v1/me", headers={"X-Development-Subject": "dev:ghost"})
    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
