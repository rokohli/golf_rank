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
    assert client.get("/api/v1/feed", headers=alice).json() == {"items": [], "next_cursor": None}

    client.put(f"/api/v1/me/follows/{alice_id}", headers=bob)
    mutual_feed = client.get("/api/v1/feed", headers=alice).json()["items"]
    assert mutual_feed[0]["event_type"] == "round_logged"
    assert mutual_feed[0]["data"]["score"] == 80
    assert "note" not in mutual_feed[0]["data"]

    client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={"course_id": 2, "played_on": "2026-07-02", "visibility": "private"},
    )
    feed = client.get("/api/v1/feed", headers=alice).json()["items"]
    assert all(item["course"]["id"] != 2 for item in feed)


def test_user_search_does_not_expose_provider_subjects() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:search-alice", "Alice", "alice")
    _profile(client, "dev:search-bob", "Bob", "bob")
    result = client.get("/api/v1/users", headers=alice, params={"q": "bob"})
    assert result.status_code == 200
    assert "provider_subject" not in result.json()[0]


def test_feed_reactions_are_idempotent_and_private_events_are_not_reactable() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:reaction-alice", "Alice", "alice")
    bob = _profile(client, "dev:reaction-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    created = client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={"course_id": 1, "played_on": "2026-07-01", "score": 80, "visibility": "public"},
    )
    assert created.status_code == 201
    event = client.get("/api/v1/feed", headers=alice).json()["items"][0]

    first = client.put(f"/api/v1/feed/{event['id']}/reactions/like", headers=alice)
    second = client.put(f"/api/v1/feed/{event['id']}/reactions/like", headers=alice)
    assert first.json()["reaction_count"] == second.json()["reaction_count"] == 1
    assert second.json()["viewer_reacted"] is True
    removed = client.delete(f"/api/v1/feed/{event['id']}/reactions/like", headers=alice)
    assert removed.json()["reaction_count"] == 0


def test_block_removes_relationship_and_hides_users_and_feed() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:block-alice", "Alice", "alice")
    bob = _profile(client, "dev:block-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={"course_id": 1, "played_on": "2026-07-01", "visibility": "public"},
    )
    assert client.get("/api/v1/feed", headers=alice).json()["items"]

    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204
    assert client.get("/api/v1/feed", headers=alice).json()["items"] == []
    assert client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json() == []
    assert client.get("/api/v1/me/follows", headers=alice).json() == []


def test_course_ratings_and_reratings_appear_but_refinement_does_not() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:rating-feed-alice", "Alice", "alice")
    bob = _profile(client, "dev:rating-feed-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "alice"}).json()[0]["id"]
    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    client.put(f"/api/v1/me/follows/{alice_id}", headers=bob)

    rating = {"tier": "green", "played_on": "2026-07-01", "score": 80}
    for _ in range(2):
        assert client.put("/api/v1/me/course-ratings/1", headers=bob, json=rating).status_code == 200
        assert client.patch(
            "/api/v1/me/course-ratings/1/details",
            headers=bob,
            json={"note": None, "favorite_hole": None, "friend_user_ids": [], "guest_names": [], "visibility": "friends"},
        ).status_code == 200
    events = client.get("/api/v1/feed", headers=alice).json()["items"]
    assert [event["event_type"] for event in events].count("course_rated") == 2

    assert client.put("/api/v1/me/course-ratings/2", headers=bob, json=rating).status_code == 200
    assert client.post(
        "/api/v1/me/rankings/comparisons",
        headers=bob,
        json={"course_a_id": 1, "course_b_id": 2, "result": "too_close"},
    ).status_code == 200
    events = client.get("/api/v1/feed", headers=alice).json()["items"]
    assert all(event["event_type"] != "ranking_updated" for event in events)


def test_feed_cursor_is_stable_and_mute_hides_followed_activity() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:cursor-alice", "Alice", "alice")
    bob = _profile(client, "dev:cursor-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    for day in (1, 2, 3):
        client.post(
            "/api/v1/me/rounds",
            headers=bob,
            json={"course_id": 1, "played_on": f"2026-07-0{day}", "visibility": "public"},
        )

    first = client.get("/api/v1/feed", headers=alice, params={"limit": 1}).json()
    second = client.get("/api/v1/feed", headers=alice, params={"limit": 1, "cursor": first["next_cursor"]}).json()
    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert first["next_cursor"] is not None

    assert client.put(f"/api/v1/me/mutes/{bob_id}", headers=alice).status_code == 204
    assert client.get("/api/v1/feed", headers=alice).json()["items"] == []
