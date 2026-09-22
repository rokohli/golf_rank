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
    assert client.put(
        "/api/v1/me/push-tokens", headers=alice, json={"token": "ExponentPushToken[export-alice]"}
    ).status_code == 204
    assert client.put(
        "/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[export-bob]"}
    ).status_code == 204

    response = client.get("/api/v1/me/data-export", headers=alice)

    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="golfrank-data-export.json"'
    exported = response.json()
    assert exported["export_version"] == 1
    assert exported["profile"]["onboarding_data"]["username"] == "exportalice"
    assert [round_["score"] for round_ in exported["rounds"]] == [80]
    assert len(exported["linked_contacts"]) == 1
    assert {n["notification_type"] for n in exported["notifications"]} == {"followed_you", "mutual_follow"}
    assert all(n["recipient_user_id"] == alice_id and n["actor_user_id"] == bob_id for n in exported["notifications"])
    assert [t["token"] for t in exported["push_tokens"]] == ["ExponentPushToken[export-alice]"]
    assert "provider_subject" not in str(exported)


def test_onboarding_seeds_dream_courses_and_played_courses() -> None:
    client = TestClient(create_app())
    headers = {"X-Development-Subject": "dev:onboarding-seeder"}
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 175,
            "difficulty": "intermediate",
            "access": "public",
            "onboarding_data": {
                "first_name": "Tiger",
                "last_name": "Golfer",
                "username": "tigergolf",
                "home_course_id": "1",
                "home_course_search": "Pebble Beach",
                "played_course_ids": ["1", "2"],
                "favorite_wins": ["1"],
                "dream_course_ids": ["3"],
                "preferences": ["Scenic views"],
                "group_size": "Foursome",
                "budget": "$$",
                "travel_distance": "Up to 45 minutes",
                "preferred_tee_time": "Weekend mornings",
                "transportation": "Cart",
                "notifications": True,
            },
        },
    )
    assert response.status_code == 200

    # Verify dream course was seeded into default "Want to play" saved list
    saved_lists = client.get("/api/v1/me/saved-lists", headers=headers)
    assert saved_lists.status_code == 200
    lists = saved_lists.json()
    assert len(lists) == 1
    assert lists[0]["name"] == "Want to play"
    assert lists[0]["is_default"] is True
    assert [item["course"]["id"] for item in lists[0]["courses"]] == [3]

    # Verify played courses were seeded into UserCourseState and are queryable
    played = client.get("/api/v1/me/course-states", headers=headers)
    assert played.status_code == 200
    played_ids = {item["course"]["id"] for item in played.json() if item["has_played"]}
    assert {1, 2}.issubset(played_ids)


def test_resolve_course_optional_disambiguates_and_rejects_ambiguity() -> None:
    from app.domain import resolve_course_optional
    from app.models import Course, CourseReconciliation

    app = create_app()
    with app.state.session_factory() as session:
        # Create two distinct courses from different sources sharing source_course_id="shared-id"
        c1 = Course(
            name="Alpha Links",
            region="Monterey, CA",
            latitude=36.5,
            longitude=-121.9,
            source="provider_a",
            source_course_id="shared-id",
        )
        c2 = Course(
            name="Beta Dunes",
            region="Bandon, OR",
            latitude=43.1,
            longitude=-124.4,
            source="provider_b",
            source_course_id="shared-id",
        )
        # Create a unique course
        c3 = Course(
            name="Gamma Pines",
            region="Pinehurst, NC",
            latitude=35.2,
            longitude=-79.5,
            source="provider_c",
            source_course_id="unique-id",
        )
        session.add_all([c1, c2, c3])
        session.commit()

        # Integer PK lookup
        assert resolve_course_optional(session, c1.id).id == c1.id
        assert resolve_course_optional(session, str(c1.id)).id == c1.id

        # Unique source_course_id resolves directly
        assert resolve_course_optional(session, "unique-id").id == c3.id

        # Source-qualified ID disambiguates between the two shared-id courses
        assert resolve_course_optional(session, "provider_a:shared-id").id == c1.id
        assert resolve_course_optional(session, "provider_b:shared-id").id == c2.id

        # Ambiguous source_course_id without source qualification is rejected (returns None)
        assert resolve_course_optional(session, "shared-id") is None

        # When ambiguous courses are reconciled to the same canonical course, it resolves
        recon = CourseReconciliation(
            source="provider_b",
            source_course_id="shared-id",
            canonical_course_id=c1.id,
            match_status="confirmed",
        )
        session.add(recon)
        session.commit()
        # Now both provider_a and provider_b point to canonical c1
        assert resolve_course_optional(session, "shared-id").id == c1.id

        # Add a 3rd provider course sharing source_course_id="shared-id" that is NOT reconciled to c1
        c4 = Course(
            name="Delta Highlands",
            region="Highlands, NC",
            latitude=35.0,
            longitude=-83.2,
            source="provider_d",
            source_course_id="shared-id",
        )
        session.add(c4)
        session.commit()

        # Unqualified "shared-id" must inspect all 3 matches and reject because c4 does not resolve to c1
        assert resolve_course_optional(session, "shared-id") is None

        # Once provider_d is also reconciled to c1, all 3 matches agree and resolve to c1
        recon_d = CourseReconciliation(
            source="provider_d",
            source_course_id="shared-id",
            canonical_course_id=c1.id,
            match_status="confirmed",
        )
        session.add(recon_d)
        session.commit()
        assert resolve_course_optional(session, "shared-id").id == c1.id

        # Invalid / unknown inputs return None
        assert resolve_course_optional(session, None) is None
        assert resolve_course_optional(session, "") is None
        assert resolve_course_optional(session, "nonexistent-id-xyz") is None


def test_onboarding_played_course_preserved_across_round_deletion() -> None:
    client = TestClient(create_app())
    headers = {"X-Development-Subject": "dev:onboarding-round-delete"}
    # 1. Complete onboarding with course 1 as played
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 175,
            "difficulty": "intermediate",
            "access": "public",
            "onboarding_data": {
                "first_name": "Rory",
                "last_name": "Golfer",
                "username": "rorygolf",
                "home_course_id": "1",
                "home_course_search": "Pebble Beach",
                "played_course_ids": ["1"],
                "favorite_wins": [],
                "dream_course_ids": [],
                "travel_distance": "Up to 45 minutes",
                "preferred_tee_time": "Weekend mornings",
            },
        },
    )
    assert response.status_code == 200

    # Course 1 is recorded as played with round_count=0
    states = client.get("/api/v1/me/course-states", headers=headers).json()
    assert any(s["course"]["id"] == 1 and s["has_played"] and s["round_count"] == 0 for s in states)

    # 2. Log a round for course 1
    logged_1 = client.post(
        "/api/v1/me/rounds",
        headers=headers,
        json={"course_id": 1, "played_on": "2026-07-01", "score": 72, "visibility": "public"},
    )
    assert logged_1.status_code == 201
    round_1_id = logged_1.json()["id"]

    # Course 1 now has round_count=1
    states = client.get("/api/v1/me/course-states", headers=headers).json()
    assert any(s["course"]["id"] == 1 and s["has_played"] and s["round_count"] == 1 for s in states)

    # 3. Log and delete a round for course 2 (not in onboarding)
    logged_2 = client.post(
        "/api/v1/me/rounds",
        headers=headers,
        json={"course_id": 2, "played_on": "2026-07-02", "score": 75, "visibility": "public"},
    )
    assert logged_2.status_code == 201
    round_2_id = logged_2.json()["id"]

    deleted_2 = client.delete(f"/api/v1/me/rounds/{round_2_id}", headers=headers)
    assert deleted_2.status_code == 204
    states = client.get("/api/v1/me/course-states", headers=headers).json()
    assert not any(s["course"]["id"] == 2 and s["has_played"] for s in states)

    # 4. Delete the only round for course 1 (which WAS in onboarding)
    deleted_1 = client.delete(f"/api/v1/me/rounds/{round_1_id}", headers=headers)
    assert deleted_1.status_code == 204

    # Course 1 MUST still be in played history with has_played=True, round_count=0
    states = client.get("/api/v1/me/course-states", headers=headers).json()
    course_1_state = next(s for s in states if s["course"]["id"] == 1)
    assert course_1_state["has_played"] is True
    assert course_1_state["round_count"] == 0


