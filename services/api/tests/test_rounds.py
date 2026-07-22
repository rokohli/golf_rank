from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import create_app
from app.models import (
    ActivityEvent,
    Comparison,
    RankingConfidence,
    RankingSnapshot,
    Round,
    RoundCompanion,
    RoundNote,
    TierAssignment,
    User,
    UserCourseRating,
    UserCourseState,
)


ALICE = {"X-Development-Subject": "dev:round-alice"}
BOB = {"X-Development-Subject": "dev:round-bob"}


def _profile(client: TestClient, headers: dict[str, str], first_name: str, username: str) -> None:
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


def test_round_crud_keeps_notes_private_and_updates_course_state() -> None:
    client = TestClient(create_app())
    created = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 1,
            "played_on": "2026-07-01",
            "score": 84,
            "note": "Windy back nine",
            "visibility": "friends",
        },
    )
    assert created.status_code == 201
    round_id = created.json()["id"]
    assert created.json()["score"] == 84
    assert created.json()["note"] == "Windy back nine"

    other_user = client.get(f"/api/v1/me/rounds/{round_id}", headers=BOB)
    assert other_user.status_code == 404

    updated = client.patch(
        f"/api/v1/me/rounds/{round_id}",
        headers=ALICE,
        json={"score": 82, "note": None, "visibility": "public"},
    )
    assert updated.status_code == 200
    assert updated.json()["score"] == 82
    assert updated.json()["note"] is None

    states = client.get("/api/v1/me/course-states", headers=ALICE)
    assert states.status_code == 200
    assert states.json()[0]["round_count"] == 1
    assert states.json()[0]["last_played_on"] == "2026-07-01"

    deleted = client.delete(f"/api/v1/me/rounds/{round_id}", headers=ALICE)
    assert deleted.status_code == 204
    assert client.get("/api/v1/me/course-states", headers=ALICE).json() == []


def test_round_rejects_future_dates_and_unrealistic_scores() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={"course_id": 1, "played_on": "2099-01-01", "score": 12},
    )
    assert response.status_code == 422


def test_repeated_course_visits_are_distinct_and_summary_and_filters_are_derived() -> None:
    client = TestClient(create_app())
    first = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 1,
            "played_on": "2025-12-20",
            "score": 90,
            "is_favorite": False,
        },
    )
    second = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 1,
            "played_on": "2026-07-02",
            "score": 80,
            "is_favorite": True,
        },
    )
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    rounds = client.get("/api/v1/me/rounds", headers=ALICE).json()
    assert [item["score"] for item in rounds] == [80, 90]
    assert all(item["course"]["id"] == 1 for item in rounds)
    assert all(item["is_rating_round"] is False for item in rounds)
    assert client.get(
        "/api/v1/me/rounds", headers=ALICE, params={"year": 2026}
    ).json() == [second.json()]
    assert client.get(
        "/api/v1/me/rounds", headers=ALICE, params={"favorites_only": True}
    ).json() == [second.json()]

    summary = client.get("/api/v1/me/rounds/summary", headers=ALICE)
    assert summary.status_code == 200
    assert summary.json()["total_rounds"] == 2
    assert summary.json()["rounds_this_year"] == 1
    assert summary.json()["average_score"] == 85.0
    assert summary.json()["best_score"] == 80
    assert summary.json()["distinct_courses"] == 1
    assert summary.json()["latest_round"]["id"] == second.json()["id"]


def test_round_companions_and_favorite_hole_can_be_created_and_replaced() -> None:
    client = TestClient(create_app())
    _profile(client, ALICE, "Alice", "roundalice")
    _profile(client, BOB, "Bob", "roundbob")
    bob_id = client.get("/api/v1/users", headers=ALICE, params={"q": "roundbob"}).json()[0]["id"]
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=ALICE).status_code == 200

    created = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 1,
            "played_on": "2026-07-01",
            "favorite_hole": 7,
            "friend_user_ids": [bob_id, bob_id],
            "guest_names": [" Alex ", "Alex"],
        },
    )
    assert created.status_code == 201
    assert created.json()["favorite_hole"] == 7
    assert created.json()["companions"] == [
        {"friend_user_id": bob_id, "display_name": "Bob Golfer", "guest_name": None},
        {"friend_user_id": None, "display_name": None, "guest_name": "Alex"},
    ]

    updated = client.patch(
        f"/api/v1/me/rounds/{created.json()['id']}",
        headers=ALICE,
        json={"favorite_hole": None, "friend_user_ids": [], "guest_names": ["Jordan"]},
    )
    assert updated.status_code == 200
    assert updated.json()["favorite_hole"] is None
    assert updated.json()["companions"] == [
        {"friend_user_id": None, "display_name": None, "guest_name": "Jordan"}
    ]

    partial_companions = client.patch(
        f"/api/v1/me/rounds/{created.json()['id']}",
        headers=ALICE,
        json={"guest_names": []},
    )
    assert partial_companions.status_code == 422


def test_round_rejects_companion_who_is_not_followed() -> None:
    client = TestClient(create_app())
    _profile(client, ALICE, "Alice", "aliceunfollowed")
    _profile(client, BOB, "Bob", "bobunfollowed")
    bob_id = client.get("/api/v1/users", headers=ALICE, params={"q": "bobunfollowed"}).json()[0]["id"]
    response = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 1,
            "played_on": "2026-07-01",
            "friend_user_ids": [bob_id],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "All friend_user_ids must be followed users"


def test_deleting_round_removes_its_note_without_sqlite_cascades() -> None:
    app = create_app()
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 1,
            "played_on": "2026-07-01",
            "note": "Private swing thought",
        },
    )
    assert created.status_code == 201
    round_id = created.json()["id"]

    deleted = client.delete(f"/api/v1/me/rounds/{round_id}", headers=ALICE)
    assert deleted.status_code == 204

    with app.state.session_factory() as session:
        assert session.get(RoundNote, round_id) is None


def test_rating_owned_round_cannot_be_made_public_through_generic_round_api() -> None:
    app = create_app()
    client = TestClient(app)
    rating = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json={"tier": "green", "played_on": "2026-07-01", "score": None},
    )
    assert rating.status_code == 200
    round_id = rating.json()["round"]["id"]

    edited = client.patch(
        f"/api/v1/me/rounds/{round_id}",
        headers=ALICE,
        json={"score": 79, "favorite_hole": 7, "note": "Fast greens"},
    )
    assert edited.status_code == 200
    assert edited.json()["score"] == 79
    assert edited.json()["favorite_hole"] == 7
    assert edited.json()["note"] == "Fast greens"
    with app.state.session_factory() as session:
        event = session.scalar(select(ActivityEvent).where(
            ActivityEvent.subject_type == "rating_round",
            ActivityEvent.subject_id == round_id,
        ))
        assert event is not None
        assert event.event_data == {
            "course_id": 1,
            "played_on": "2026-07-01",
            "score": 79,
            "rating": rating.json()["personal_rating"],
            "tier": "green",
        }
        assert "note" not in event.event_data

    unranked = client.put(
        "/api/v1/me/rankings/tiers",
        headers=ALICE,
        json={"assignments": [{"course_id": 1, "tier": "not_sure"}]},
    )
    assert unranked.status_code == 200
    rating_state = client.get("/api/v1/me/course-ratings/1", headers=ALICE).json()
    assert rating_state["personal_rating"] is None
    assert rating_state["community_rating"] is None
    assert rating_state["round"] is None
    with app.state.session_factory() as session:
        retained_round = session.get(Round, round_id)
        assert retained_round is not None
        assert retained_round.is_rating_round is True

    rejected = client.patch(
        f"/api/v1/me/rounds/{round_id}",
        headers=ALICE,
        json={"visibility": "public"},
    )
    assert rejected.status_code == 422
    retained = client.get(f"/api/v1/me/rounds/{round_id}", headers=ALICE)
    assert retained.status_code == 200
    assert retained.json()["visibility"] == "private"

    ordinary = client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={"course_id": 2, "played_on": "2026-07-01", "visibility": "friends"},
    )
    public = client.patch(
        f"/api/v1/me/rounds/{ordinary.json()['id']}",
        headers=ALICE,
        json={"visibility": "public"},
    )
    assert public.status_code == 200
    assert public.json()["visibility"] == "public"


def test_deleting_rating_round_removes_its_ranking_evidence_and_restages_snapshot() -> None:
    app = create_app()
    client = TestClient(app)
    deleted_rating = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json={"tier": "green", "played_on": "2026-07-01", "score": 82},
    )
    assert deleted_rating.status_code == 200
    round_id = deleted_rating.json()["round"]["id"]
    remaining_rating = client.put(
        "/api/v1/me/course-ratings/2",
        headers=ALICE,
        json={
            "tier": "green",
            "played_on": "2026-07-02",
            "score": 79,
            "comparison_course_id": 1,
            "comparison_result": "course_a",
        },
    )
    assert remaining_rating.status_code == 200
    details = client.patch(
        "/api/v1/me/course-ratings/1/details",
        headers=ALICE,
        json={
            "guest_names": ["Guest Golfer"],
            "note": "Delete with the rating",
            "visibility": "private",
        },
    )
    assert details.status_code == 200

    deleted = client.delete(f"/api/v1/me/rounds/{round_id}", headers=ALICE)

    assert deleted.status_code == 204
    with app.state.session_factory() as session:
        user_id = session.scalar(
            select(User.id).where(User.provider_subject == ALICE["X-Development-Subject"])
        )
        assert user_id is not None
        assert session.scalar(
            select(func.count(UserCourseRating.id)).where(
                UserCourseRating.user_id == user_id,
                UserCourseRating.course_id == 1,
            )
        ) == 0
        remaining_projection = session.scalar(
            select(UserCourseRating).where(
                UserCourseRating.user_id == user_id,
                UserCourseRating.course_id == 2,
            )
        )
        assert remaining_projection is not None
        assert remaining_projection.rating == 9.2
        assert remaining_projection.confidence == 0.35
        assert session.get(Round, round_id) is None
        assert session.scalar(select(func.count(RoundCompanion.id))) == 0
        assert session.get(RoundNote, round_id) is None
        assert session.scalar(
            select(func.count(TierAssignment.id)).where(
                TierAssignment.user_id == user_id,
                TierAssignment.course_id == 1,
            )
        ) == 0
        remaining_assignment = session.scalar(
            select(TierAssignment).where(
                TierAssignment.user_id == user_id,
                TierAssignment.course_id == 2,
            )
        )
        assert remaining_assignment is not None
        assert remaining_assignment.ordinal_position == 1
        assert session.scalar(
            select(func.count(RankingConfidence.id)).where(
                RankingConfidence.user_id == user_id,
                RankingConfidence.course_id == 1,
            )
        ) == 0
        remaining_confidence = session.scalar(
            select(RankingConfidence).where(
                RankingConfidence.user_id == user_id,
                RankingConfidence.course_id == 2,
            )
        )
        assert remaining_confidence is not None
        assert remaining_confidence.score == 0.35
        assert remaining_confidence.decisive_comparisons == 0
        assert session.scalar(
            select(func.count(Comparison.id)).where(Comparison.user_id == user_id)
        ) == 0
        latest_snapshot = session.scalar(
            select(RankingSnapshot)
            .where(RankingSnapshot.user_id == user_id)
            .order_by(RankingSnapshot.version.desc())
            .limit(1)
        )
        assert latest_snapshot is not None
        assert [
            entry["course"]["id"] for entry in latest_snapshot.ranking_data["entries"]
        ] == [2]
        assert session.scalar(
            select(func.count(ActivityEvent.id)).where(
                ActivityEvent.actor_user_id == user_id,
                ActivityEvent.subject_type.in_(("round", "rating_round")),
                ActivityEvent.subject_id == round_id,
            )
        ) == 0
        latest_event = session.scalar(
            select(ActivityEvent)
            .where(
                ActivityEvent.actor_user_id == user_id,
                ActivityEvent.event_type == "ranking_updated",
            )
            .order_by(ActivityEvent.id.desc())
            .limit(1)
        )
        assert latest_event is not None
        assert latest_event.subject_id == latest_snapshot.version
        deleted_state = session.scalar(
            select(UserCourseState).where(
                UserCourseState.user_id == user_id,
                UserCourseState.course_id == 1,
            )
        )
        assert deleted_state is not None
        assert deleted_state.has_played is False
        assert deleted_state.round_count == 0

    deleted_course = client.get("/api/v1/courses/1").json()
    assert deleted_course["community_rating"] is None
    assert deleted_course["rating_count"] == 0
    remaining_course = client.get("/api/v1/courses/2").json()
    assert remaining_course["community_rating"] == 9.2
    assert remaining_course["rating_count"] == 1
    deleted_state = client.get("/api/v1/me/course-ratings/1", headers=ALICE).json()
    assert deleted_state["personal_rating"] is None
    assert deleted_state["round"] is None
    remaining_state = client.get("/api/v1/me/course-ratings/2", headers=ALICE).json()
    assert remaining_state["personal_rating"] == 9.2
    assert remaining_state["confidence"] == 0.35
    assert remaining_state["round"] is not None
    ranking = client.get("/api/v1/me/rankings", headers=ALICE).json()
    assert [entry["course"]["id"] for entry in ranking["entries"]] == [2]
    assert ranking["entries"][0]["rank"] == 1
    assert ranking["entries"][0]["tier_position"] == 1
    course_states = client.get("/api/v1/me/course-states", headers=ALICE).json()
    assert [state["course"]["id"] for state in course_states] == [2]


def test_deleting_rating_round_locks_before_removing_ranking_evidence(monkeypatch) -> None:
    from app import ranking, rounds

    app = create_app()
    client = TestClient(app)
    rating = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json={"tier": "green", "played_on": "2026-07-01", "score": None},
    )
    assert rating.status_code == 200
    calls: list[str] = []
    original_lock = ranking._lock_user_for_ranking_update
    original_event_delete = rounds._delete_round_activity_event
    original_delete = rounds._delete_rating_ranking_evidence

    def tracked_lock(session, user_id):
        calls.append("lock")
        return original_lock(session, user_id)

    def tracked_event_delete(session, user_id, round_id):
        assert calls == ["lock"]
        calls.append("event_delete")
        return original_event_delete(session, user_id, round_id)

    def tracked_delete(session, user_id, course_id):
        assert calls == ["lock", "event_delete"]
        calls.append("delete")
        return original_delete(session, user_id, course_id)

    monkeypatch.setattr(ranking, "_lock_user_for_ranking_update", tracked_lock)
    monkeypatch.setattr(rounds, "_delete_round_activity_event", tracked_event_delete)
    monkeypatch.setattr(rounds, "_delete_rating_ranking_evidence", tracked_delete)

    response = client.delete(
        f"/api/v1/me/rounds/{rating.json()['round']['id']}", headers=ALICE
    )

    assert response.status_code == 204
    # _stage_snapshot deliberately reacquires the same row lock before versioning.
    assert calls == ["lock", "event_delete", "delete", "lock"]
