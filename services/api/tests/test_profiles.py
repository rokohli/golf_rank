from fastapi.testclient import TestClient

from app.main import create_app


def test_onboarding_upserts_current_user_preferences() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 250,
            "difficulty": "challenging",
            "access": "public",
            "onboarding_data": {
                "first_name": "Alice",
                "last_name": "Golfer",
                "username": "Alice",
                "home_course_id": "pebble",
                "home_course_search": "Pebble Beach Golf Links",
                "played_course_ids": ["pebble"],
                "favorite_wins": ["pebble"],
                "dream_course_ids": ["bandon"],
                "preferences": ["Scenic views"],
                "group_size": "Foursome",
                "budget": "$$$",
                "travel_distance": "Up to 45 minutes",
                "preferred_tee_time": "Weekend mornings",
                "transportation": "Cart",
                "notifications": True,
                "profile_visibility": "friends",
                "default_round_visibility": "private",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["home_region"] == "Monterey, CA"
    assert response.json()["onboarding_data"]["played_course_ids"] == ["pebble"]
    assert response.json()["onboarding_data"]["username"] == "alice"
    assert "profile_visibility" not in response.json()["onboarding_data"]
    assert response.json()["onboarding_data"]["default_round_visibility"] == "private"

    profile = client.get(
        "/api/v1/me/profile", headers={"X-Development-Subject": "dev:alice"}
    )
    assert profile.status_code == 200
    assert profile.json()["onboarding_data"]["dream_course_ids"] == ["bandon"]
    assert "profile_visibility" not in profile.json()["onboarding_data"]

    legacy_update = client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 300,
            "difficulty": "any",
            "access": "any",
        },
    )
    assert legacy_update.status_code == 200
    assert legacy_update.json()["onboarding_data"]["dream_course_ids"] == ["bandon"]


def test_usernames_are_unique_across_profiles() -> None:
    client = TestClient(create_app())
    payload = {
        "home_region": "Monterey, CA",
        "max_green_fee": 250,
        "difficulty": "any",
        "access": "any",
        "onboarding_data": {
            "first_name": "Alice",
            "last_name": "Golfer",
            "username": "fairway_ace",
            "home_course_search": "Pebble Beach",
            "travel_distance": "Any",
            "preferred_tee_time": "Morning",
        },
    }
    assert client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice-unique"},
        json=payload,
    ).status_code == 200

    duplicate = client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:bob-unique"},
        json={
            **payload,
            "onboarding_data": {
                **payload["onboarding_data"],
                "first_name": "Bob",
                "username": "Fairway_Ace",
            },
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "That username is already taken."

    available = client.get(
        "/api/v1/usernames/available",
        headers={"X-Development-Subject": "dev:bob-unique"},
        params={"username": "Fairway_Ace"},
    )
    assert available.status_code == 200
    assert available.json() == {"available": False, "username": "fairway_ace"}

    own = client.get(
        "/api/v1/usernames/available",
        headers={"X-Development-Subject": "dev:alice-unique"},
        params={"username": "@fairway_ace"},
    )
    assert own.status_code == 200
    assert own.json() == {"available": True, "username": "fairway_ace"}

    assert client.get(
        "/api/v1/usernames/available",
        headers={"X-Development-Subject": "dev:bob-unique"},
        params={"username": "new_golfer"},
    ).json() == {"available": True, "username": "new_golfer"}


def test_profile_is_scoped_to_current_user() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={"home_region": "Monterey, CA", "max_green_fee": 250, "difficulty": "any", "access": "any"},
    )

    response = client.get("/api/v1/me/profile", headers={"X-Development-Subject": "dev:bob"})

    assert response.status_code == 404


def test_data_export_contains_only_the_authenticated_users_application_data() -> None:
    client = TestClient(create_app())
    alice = {"X-Development-Subject": "dev:export-alice"}
    bob = {"X-Development-Subject": "dev:export-bob"}
    for headers, first_name, username in ((alice, "Alice", "exportalice"), (bob, "Bob", "exportbob")):
        assert client.put(
            "/api/v1/me/onboarding-preferences",
            headers=headers,
            json={
                "home_region": "Monterey, CA", "max_green_fee": 250,
                "difficulty": "any", "access": "any",
                "onboarding_data": {
                    "first_name": first_name, "last_name": "Golfer", "username": username,
                    "home_course_search": "Pebble Beach", "travel_distance": "Any",
                    "preferred_tee_time": "Morning",
                },
            },
        ).status_code == 200
    assert client.post(
        "/api/v1/me/rounds", headers=alice,
        json={"course_id": 1, "played_on": "2026-07-01", "score": 80, "visibility": "private"},
    ).status_code == 201
    assert client.post(
        "/api/v1/me/rounds", headers=bob,
        json={"course_id": 2, "played_on": "2026-07-02", "score": 90, "visibility": "private"},
    ).status_code == 201
    assert client.put(
        "/api/v1/me/contacts",
        headers=alice,
        json={"contact_identifiers": ["bob@example.com"]},
    ).status_code == 204
    assert client.put(
        "/api/v1/me/contacts",
        headers=bob,
        json={"contact_identifiers": ["alice@example.com", "alice-mobile@example.com"]},
    ).status_code == 204
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "exportalice"}).json()[0]["id"]
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "exportbob"}).json()[0]["id"]
    assert client.put(f"/api/v1/me/follows/{alice_id}", headers=bob).status_code == 200
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200

    response = client.get("/api/v1/me/data-export", headers=alice)

    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="golfrank-data-export.json"'
    exported = response.json()
    assert exported["export_version"] == 1
    assert exported["profile"]["onboarding_data"]["username"] == "exportalice"
    assert [round_["score"] for round_ in exported["rounds"]] == [80]
    assert len(exported["linked_contacts"]) == 1
    assert len(exported["notifications"]) == 1
    assert exported["notifications"][0]["recipient_user_id"] == alice_id
    assert exported["notifications"][0]["actor_user_id"] == bob_id
    assert "provider_subject" not in str(exported)
