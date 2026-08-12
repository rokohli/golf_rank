from datetime import date, datetime

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import create_app
from app.models import (
    ActivityEvent,
    Course,
    CourseReconciliation,
    Follow,
    OnboardingPreference,
    Round,
    RoundNote,
    User,
    UserCourseRating,
    UserMute,
)


def _profile(client: TestClient, subject: str, first_name: str, username: str, visibility: str = "public") -> dict[str, str]:
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
                "profile_visibility": visibility,
            },
        },
    )
    assert response.status_code == 200
    return headers


def _mutual_friend(client: TestClient, alice: dict[str, str], bob: dict[str, str], username: str) -> int:
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": username}).json()[0]["id"]
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "alice"}).json()[0]["id"]
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert client.put(f"/api/v1/me/follows/{alice_id}", headers=bob).status_code == 200
    return bob_id


def _rate_course(client: TestClient, headers: dict[str, str], course_id: int, *, visibility: str, note: str | None = None, favorite_hole: int | None = None) -> dict:
    response = client.put(
        f"/api/v1/me/course-ratings/{course_id}", headers=headers,
        json={"tier": "green", "played_on": "2026-07-01", "score": 80},
    )
    assert response.status_code == 200
    details = client.patch(
        f"/api/v1/me/course-ratings/{course_id}/details", headers=headers,
        json={"note": note, "favorite_hole": favorite_hole, "friend_user_ids": [], "guest_names": [], "visibility": visibility},
    )
    assert details.status_code == 200
    return response.json()


def test_course_friend_thoughts_only_exposes_eligible_ratings_and_friends_shared_memories() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:thoughts-alice", "Alice", "alice")
    bob = _profile(client, "dev:thoughts-bob", "Bob", "bob")
    _mutual_friend(client, alice, bob, "bob")
    _rate_course(client, bob, 1, visibility="friends", note="Windy but fun.", favorite_hole=7)

    response = client.get("/api/v1/courses/1/friends-thoughts", headers=alice)
    assert response.status_code == 200
    assert response.json() == {
        "average_rating": 9.2,
        "rating_count": 1,
        "entries": [{
            "user": {"id": 2, "display_name": "Bob Golfer", "username": "bob"},
            "activity_id": 1,
            "rating": 9.2,
            "tier": "green",
            "note": "Windy but fun.",
            "favorite_hole": 7,
        }],
    }
    assert client.get("/api/v1/feed/1", headers=alice).status_code == 200

    # The rating remains a social projection, but a private round never leaks
    # its memories, score, companions, or round identifier.
    _rate_course(client, bob, 1, visibility="private", note="Private notebook", favorite_hole=9)
    private_memory = client.get("/api/v1/courses/1/friends-thoughts", headers=alice).json()
    assert private_memory["entries"][0] == {
        "user": {"id": 2, "display_name": "Bob Golfer", "username": "bob"},
        "activity_id": None,
        "rating": 9.2,
        "tier": "green",
        "note": None,
        "favorite_hole": None,
    }
    assert "round_id" not in str(private_memory)
    assert "score" not in str(private_memory)
    assert "Private notebook" not in str(private_memory)


def test_course_friend_thoughts_excludes_one_way_private_blocked_and_muted_relationships() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:thoughts-policy-alice", "Alice", "alice")
    bob = _profile(client, "dev:thoughts-policy-bob", "Bob", "bob")
    charlie = _profile(client, "dev:thoughts-policy-charlie", "Charlie", "charlie")
    private = _profile(client, "dev:thoughts-policy-private", "Private", "private")
    bob_id = _mutual_friend(client, alice, bob, "bob")
    _mutual_friend(client, alice, private, "private")
    _profile(client, "dev:thoughts-policy-private", "Private", "private", "private")
    charlie_id = client.get("/api/v1/users", headers=alice, params={"q": "charlie"}).json()[0]["id"]
    client.put(f"/api/v1/me/follows/{charlie_id}", headers=alice)  # One-way only.
    _rate_course(client, bob, 1, visibility="friends")
    _rate_course(client, charlie, 1, visibility="friends")
    # The private user can have historical state, but cannot be discovered or included.
    _rate_course(client, private, 1, visibility="friends")
    assert client.get("/api/v1/courses/1/friends-thoughts", headers=alice).json()["rating_count"] == 1

    assert client.put(f"/api/v1/me/mutes/{bob_id}", headers=alice).status_code == 204
    assert client.get("/api/v1/courses/1/friends-thoughts", headers=alice).json() == {
        "average_rating": None, "rating_count": 0, "entries": [],
    }
    assert client.delete(f"/api/v1/me/mutes/{bob_id}", headers=alice).status_code == 204
    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204
    assert client.get("/api/v1/courses/1/friends-thoughts", headers=alice).json()["entries"] == []


def test_known_private_follow_target_can_still_be_blocked_or_muted() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:private-controls-alice", "Alice", "alice")
    bob = _profile(client, "dev:private-controls-bob", "Bob", "bob")
    bob_id = _mutual_friend(client, alice, bob, "bob")
    _profile(client, "dev:private-controls-bob", "Bob", "bob", "private")

    assert client.put(f"/api/v1/me/mutes/{bob_id}", headers=alice).status_code == 204
    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204


def test_private_incoming_follow_target_can_still_be_blocked_or_muted() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:incoming-private-alice", "Alice", "alice")
    bob = _profile(client, "dev:incoming-private-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "alice"}).json()[0]["id"]
    assert client.put(f"/api/v1/me/follows/{alice_id}", headers=bob).status_code == 200
    _profile(client, "dev:incoming-private-bob", "Bob", "bob", "private")

    assert client.put(f"/api/v1/me/mutes/{bob_id}", headers=alice).status_code == 204
    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204


def test_course_friend_thoughts_links_to_newest_visible_rating_activity() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:newest-event-alice", "Alice", "alice")
    bob = _profile(client, "dev:newest-event-bob", "Bob", "bob")
    bob_id = _mutual_friend(client, alice, bob, "bob")
    rated = _rate_course(client, bob, 1, visibility="friends")
    with client.app.state.session_factory() as session:
        session.add(ActivityEvent(
            actor_user_id=bob_id,
            event_type="course_rated",
            subject_type="rating_round",
            subject_id=rated["round"]["id"],
            visibility="friends",
            event_data={"course_id": 1, "rating": rated["personal_rating"], "tier": "green"},
        ))
        session.commit()

    assert client.get("/api/v1/courses/1/friends-thoughts", headers=alice).json()["entries"][0]["activity_id"] == 2


def test_course_friend_thoughts_uses_canonical_course_identity_and_cannot_open_friend_rounds() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:thoughts-alias-alice", "Alice", "alice")
    bob = _profile(client, "dev:thoughts-alias-bob", "Bob", "bob")
    _mutual_friend(client, alice, bob, "bob")
    with client.app.state.session_factory() as session:
        alias = Course(
            name="Pebble Beach Golf Links Import", region="Pebble Beach, CA", latitude=36.568, longitude=-121.95,
            source="import", source_course_id="pebble-alias",
        )
        session.add(alias)
        session.flush()
        session.add(CourseReconciliation(source="import", source_course_id="pebble-alias", canonical_course_id=1))
        session.commit()
        alias_id = alias.id
    rated = _rate_course(client, bob, alias_id, visibility="friends", note="Alias rating", favorite_hole=8)
    thoughts = client.get("/api/v1/courses/1/friends-thoughts", headers=alice)
    assert thoughts.status_code == 200
    assert thoughts.json()["entries"][0]["note"] == "Alias rating"
    assert thoughts.json()["rating_count"] == 1
    # The only existing round detail route remains owner scoped.
    assert client.get(f"/api/v1/me/rounds/{rated['round']['id']}", headers=alice).status_code == 404


def test_course_friend_thoughts_aggregates_all_visible_friends_but_limits_recent_entries() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:thoughts-limit-alice", "Alice", "alice")
    with client.app.state.session_factory() as session:
        viewer = session.scalar(select(User).where(User.provider_subject == "dev:thoughts-limit-alice"))
        assert viewer is not None
        for index in range(11):
            friend = User(provider_subject=f"dev:thoughts-limit-friend-{index}")
            session.add(friend)
            session.flush()
            session.add(OnboardingPreference(
                user_id=friend.id, max_green_fee=700, difficulty="any", access="any",
                onboarding_data={"first_name": f"Friend {index}", "username": f"friend{index}", "profile_visibility": "friends"},
            ))
            session.add_all([
                Follow(follower_id=viewer.id, followed_id=friend.id),
                Follow(follower_id=friend.id, followed_id=viewer.id),
            ])
            round_ = Round(user_id=friend.id, course_id=1, played_on=date(2026, 7, 1), visibility="friends", is_rating_round=True)
            session.add(round_)
            session.flush()
            session.add(UserCourseRating(user_id=friend.id, course_id=1, round_id=round_.id, tier="fairway", rating=8.0, confidence=0.7))
        session.commit()

    response = client.get("/api/v1/courses/1/friends-thoughts", headers=alice)
    assert response.status_code == 200
    body = response.json()
    assert body["average_rating"] == 8.0
    assert body["rating_count"] == 11
    assert len(body["entries"]) == 10


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


def test_user_search_enforces_profile_visibility() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:privacy-alice", "Alice", "privacyalice")
    bob = _profile(client, "dev:privacy-bob", "Bob", "privacybob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "privacybob"}).json()[0]["id"]
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "privacyalice"}).json()[0]["id"]

    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    client.put(f"/api/v1/me/follows/{alice_id}", headers=bob)
    _profile(client, "dev:privacy-bob", "Bob", "privacybob", "friends")
    assert client.get("/api/v1/users", headers=alice, params={"q": "privacybob"}).json()[0]["id"] == bob_id

    client.delete(f"/api/v1/me/follows/{alice_id}", headers=bob)
    assert client.get("/api/v1/users", headers=alice, params={"q": "privacybob"}).json() == []

    _profile(client, "dev:privacy-bob", "Bob", "privacybob", "private")
    assert client.get("/api/v1/users", headers=alice, params={"q": "privacybob"}).json() == []


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

    private_round = client.post(
        "/api/v1/me/rounds",
        headers=bob,
        json={
            "course_id": 2,
            "played_on": "2026-07-02",
            "visibility": "private",
        },
    )
    assert private_round.status_code == 201
    with client.app.state.session_factory() as session:
        private_event = session.scalar(
            select(ActivityEvent).where(
                ActivityEvent.subject_type == "round",
                ActivityEvent.subject_id == private_round.json()["id"],
            )
        )
        assert private_event is not None
        private_event_id = private_event.id

    assert client.put(
        f"/api/v1/feed/{private_event_id}/reactions/like",
        headers=alice,
    ).status_code == 404
    assert client.delete(
        f"/api/v1/feed/{private_event_id}/reactions/like",
        headers=alice,
    ).status_code == 404


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


def test_blocked_account_list_is_owner_scoped_and_can_be_unblocked() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:blocked-list-alice", "Alice", "blockedlistalice")
    bob = _profile(client, "dev:blocked-list-bob", "Bob", "blockedlistbob")
    charlie = _profile(client, "dev:blocked-list-charlie", "Charlie", "blockedlistcharlie")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "blockedlistbob"}).json()[0]["id"]
    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204

    listed = client.get("/api/v1/me/blocks", headers=alice)
    assert listed.status_code == 200
    assert listed.json()[0]["username"] == "blockedlistbob"
    assert client.get("/api/v1/me/blocks", headers=charlie).json() == []

    assert client.delete(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204
    assert client.get("/api/v1/me/blocks", headers=alice).json() == []


def test_blocking_respects_profile_visibility_and_masks_later_private_profiles() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:block-privacy-alice", "Alice", "blockprivacyalice")
    bob = _profile(client, "dev:block-privacy-bob", "Bob", "blockprivacybob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "blockprivacybob"}).json()[0]["id"]

    _profile(client, "dev:block-privacy-bob", "Bob", "blockprivacybob", "private")
    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 404

    _profile(client, "dev:block-privacy-bob", "Bob", "blockprivacybob")
    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204
    _profile(client, "dev:block-privacy-bob", "Bob", "blockprivacybob", "private")

    blocked = client.get("/api/v1/me/blocks", headers=alice)
    assert blocked.status_code == 200
    assert blocked.json()[0]["id"] == bob_id
    assert blocked.json()[0]["username"] is None
    assert blocked.json()[0]["display_name"] == "Blocked account"
    assert blocked.json()[0]["home_region"] is None
    assert blocked.json()[0]["follower_count"] == 0
    assert blocked.json()[0]["following_count"] == 0


def test_relationship_removals_cannot_change_another_users_state() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:relationship-alice", "Alice", "relationshipalice")
    bob = _profile(client, "dev:relationship-bob", "Bob", "relationshipbob")
    charlie = _profile(client, "dev:relationship-charlie", "Charlie", "relationshipcharlie")
    bob_id = client.get(
        "/api/v1/users", headers=alice, params={"q": "relationshipbob"}
    ).json()[0]["id"]

    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert client.delete(f"/api/v1/me/follows/{bob_id}", headers=charlie).status_code == 204
    assert [item["user"]["id"] for item in client.get(
        "/api/v1/me/follows", headers=alice
    ).json()] == [bob_id]

    assert client.put(f"/api/v1/me/mutes/{bob_id}", headers=alice).status_code == 204
    assert client.delete(f"/api/v1/me/mutes/{bob_id}", headers=charlie).status_code == 204
    with client.app.state.session_factory() as session:
        alice_record = session.scalar(
            select(User).where(User.provider_subject == "dev:relationship-alice")
        )
        assert alice_record is not None
        assert session.scalar(
            select(UserMute.id).where(
                UserMute.muter_id == alice_record.id,
                UserMute.muted_id == bob_id,
            )
        ) is not None

    assert client.put(f"/api/v1/me/blocks/{bob_id}", headers=alice).status_code == 204
    assert client.delete(f"/api/v1/me/blocks/{bob_id}", headers=charlie).status_code == 204
    assert client.get(
        "/api/v1/users", headers=alice, params={"q": "relationshipbob"}
    ).json() == []


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


def test_feed_cursor_pages_through_many_events_with_the_same_timestamp() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:same-time-alice", "Alice", "alice")
    bob = _profile(client, "dev:same-time-bob", "Bob", "bob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "bob"}).json()[0]["id"]
    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)

    with client.app.state.session_factory() as session:
        bob_record = session.scalar(select(User).where(User.provider_subject == "dev:same-time-bob"))
        assert bob_record is not None
        created_at = datetime(2026, 7, 15, 12, 0, 0)
        session.add_all([
            ActivityEvent(
                actor_user_id=bob_record.id,
                event_type="course_saved",
                subject_type="saved_course",
                subject_id=index,
                visibility="public",
                event_data={"course_id": 1},
                created_at=created_at,
            )
            for index in range(1, 61)
        ])
        session.commit()

    event_ids: list[int] = []
    cursor = None
    while True:
        params = {"limit": 20}
        if cursor:
            params["cursor"] = cursor
        page = client.get("/api/v1/feed", headers=alice, params=params).json()
        event_ids.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(event_ids) == 60
    assert len(set(event_ids)) == 60
