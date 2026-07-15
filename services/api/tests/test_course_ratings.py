from datetime import date, timedelta

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
    TierAssignment,
    User,
    UserCourseRating,
    UserCourseState,
)


ALICE = {"X-Development-Subject": "dev:rating-alice"}
BOB = {"X-Development-Subject": "dev:rating-bob"}


def _rating(tier: str = "green", **extra: object) -> dict:
    return {
        "tier": tier,
        "played_on": "2026-07-01",
        "score": None,
        **extra,
    }


def _create_profile(client: TestClient, headers: dict[str, str], name: str) -> int:
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 700,
            "difficulty": "any",
            "access": "any",
            "onboarding_data": {
                "first_name": name,
                "last_name": "Golfer",
                "username": name.lower(),
                "home_course_search": "Pebble Beach",
                "travel_distance": "Any",
                "preferred_tee_time": "Morning",
            },
        },
    )
    assert response.status_code == 200
    with client.app.state.session_factory() as session:
        return session.scalar(select(User.id).where(User.provider_subject == headers["X-Development-Subject"]))


def test_unrated_state_has_no_invented_personal_or_community_rating() -> None:
    client = TestClient(create_app())

    response = client.get("/api/v1/me/course-ratings/1", headers=ALICE)

    assert response.status_code == 200
    assert response.json() == {
        "course": response.json()["course"],
        "personal_rating": None,
        "tier": None,
        "confidence": None,
        "community_rating": None,
        "rating_count": 0,
        "round": None,
        "companions": [],
    }
    assert response.json()["course"]["community_rating"] is None
    assert response.json()["course"]["rating_count"] == 0


def test_candidate_is_deterministic_and_read_only() -> None:
    app = create_app()
    client = TestClient(app)
    for course_id in (2, 3):
        assert client.put(
            f"/api/v1/me/course-ratings/{course_id}", headers=ALICE, json=_rating()
        ).status_code == 200
    initial = client.get(
        "/api/v1/me/course-ratings/1/comparison-candidate",
        headers=ALICE,
        params={"tier": "green"},
    )
    assert initial.json()["id"] == 2
    compared = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json=_rating(
            comparison_course_id=2,
            comparison_result="course_a",
        ),
    )
    assert compared.status_code == 200
    with app.state.session_factory() as session:
        before = (
            session.scalar(select(func.count(RankingSnapshot.id))),
            session.scalar(select(func.count(ActivityEvent.id))),
        )

    first = client.get(
        "/api/v1/me/course-ratings/1/comparison-candidate",
        headers=ALICE,
        params={"tier": "green"},
    )
    second = client.get(
        "/api/v1/me/course-ratings/1/comparison-candidate",
        headers=ALICE,
        params={"tier": "green"},
    )

    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["id"] == 3
    with app.state.session_factory() as session:
        after = (
            session.scalar(select(func.count(RankingSnapshot.id))),
            session.scalar(select(func.count(ActivityEvent.id))),
        )
    assert after == before


def test_atomic_create_and_revision_reuse_one_private_nullable_score_round() -> None:
    app = create_app()
    client = TestClient(app)

    created = client.put("/api/v1/me/course-ratings/1", headers=ALICE, json=_rating())

    assert created.status_code == 200
    assert created.json()["personal_rating"] == 9.2
    assert created.json()["community_rating"] == 9.2
    assert created.json()["rating_count"] == 1
    assert created.json()["round"]["score"] is None
    assert created.json()["round"]["visibility"] == "private"

    revised = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json=_rating("fairway", played_on="2026-07-02", score=81),
    )
    assert revised.status_code == 200
    assert revised.json()["tier"] == "fairway"
    assert revised.json()["rating_count"] == 1
    assert revised.json()["round"]["id"] == created.json()["round"]["id"]
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count(Round.id))) == 1
        assert session.scalar(select(UserCourseState.round_count)) == 1


def test_rating_locks_user_before_reading_or_inserting_assignment(monkeypatch) -> None:
    from app import course_ratings

    app = create_app()
    client = TestClient(app)
    calls: list[str] = []
    original_lock = course_ratings._lock_user_for_ranking_update
    original_place = course_ratings._place_assignment

    def tracked_lock(session, user_id):
        calls.append("lock")
        return original_lock(session, user_id)

    def tracked_place(session, user_id, course_id, tier):
        assert calls == ["lock"]
        calls.append("place")
        return original_place(session, user_id, course_id, tier)

    monkeypatch.setattr(course_ratings, "_lock_user_for_ranking_update", tracked_lock)
    monkeypatch.setattr(course_ratings, "_place_assignment", tracked_place)

    response = client.put("/api/v1/me/course-ratings/1", headers=ALICE, json=_rating())

    assert response.status_code == 200
    assert calls == ["lock", "place"]


def test_second_user_changes_community_aggregate_and_public_courses() -> None:
    client = TestClient(create_app())
    client.put("/api/v1/me/course-ratings/1", headers=ALICE, json=_rating("green"))
    response = client.put("/api/v1/me/course-ratings/1", headers=BOB, json=_rating("bunker"))

    assert response.status_code == 200
    assert response.json()["community_rating"] == 6.1
    assert response.json()["rating_count"] == 2
    detail = client.get("/api/v1/courses/1").json()
    listed = next(item for item in client.get("/api/v1/courses").json() if item["id"] == 1)
    assert (detail["community_rating"], detail["rating_count"]) == (6.1, 2)
    assert (listed["community_rating"], listed["rating_count"]) == (6.1, 2)
    assert next(item for item in client.get("/api/v1/courses").json() if item["id"] == 3)["community_rating"] is None


def test_failure_after_snapshot_staging_rolls_back_everything(monkeypatch) -> None:
    from app import course_ratings

    app = create_app()
    client = TestClient(app)

    def fail_after_staging(*args, **kwargs):
        raise RuntimeError("forced projection failure")

    monkeypatch.setattr(course_ratings, "_ensure_target_rating_projection", fail_after_staging)
    try:
        client.put("/api/v1/me/course-ratings/1", headers=ALICE, json=_rating())
    except RuntimeError:
        pass

    with app.state.session_factory() as session:
        for model in (
            User,
            TierAssignment,
            Comparison,
            RankingSnapshot,
            RankingConfidence,
            ActivityEvent,
            Round,
            UserCourseRating,
            UserCourseState,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_revision_failure_restores_previous_rating_round_and_projection(monkeypatch) -> None:
    from app import course_ratings

    app = create_app()
    client = TestClient(app)
    created = client.put("/api/v1/me/course-ratings/1", headers=ALICE, json=_rating())
    assert created.status_code == 200
    before = created.json()

    def fail_after_staging(*args, **kwargs):
        raise RuntimeError("forced revision projection failure")

    monkeypatch.setattr(course_ratings, "_ensure_target_rating_projection", fail_after_staging)
    try:
        client.put(
            "/api/v1/me/course-ratings/1",
            headers=ALICE,
            json=_rating("bunker", played_on="2026-07-03", score=95),
        )
    except RuntimeError:
        pass

    assert client.get("/api/v1/me/course-ratings/1", headers=ALICE).json() == before
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count(Round.id))) == 1
        assert session.scalar(select(func.count(UserCourseRating.id))) == 1


def test_details_replace_private_data_validate_friends_and_never_accept_phone() -> None:
    app = create_app()
    client = TestClient(app)
    alice_id = _create_profile(client, ALICE, "Alice")
    bob_id = _create_profile(client, BOB, "Bob")
    client.put("/api/v1/me/course-ratings/1", headers=ALICE, json=_rating())

    rejected = client.patch(
        "/api/v1/me/course-ratings/1/details",
        headers=ALICE,
        json={"friend_user_ids": [bob_id], "guest_names": [], "visibility": "friends"},
    )
    assert rejected.status_code == 422
    client.put(f"/api/v1/me/follows/{bob_id}", headers=ALICE)
    saved = client.patch(
        "/api/v1/me/course-ratings/1/details",
        headers=ALICE,
        json={
            "note": "  Great greens  ",
            "favorite_hole": 7,
            "friend_user_ids": [bob_id, bob_id],
            "guest_names": ["  Guest Golfer  ", "Guest Golfer"],
            "visibility": "friends",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["round"]["note"] == "  Great greens  "
    assert saved.json()["companions"] == [
        {"friend_user_id": bob_id, "guest_name": None},
        {"friend_user_id": None, "guest_name": "Guest Golfer"},
    ]
    assert "phone" not in str(saved.json()).lower()
    assert client.get("/api/v1/me/course-ratings/1", headers=BOB).json()["round"] is None
    phone = client.patch(
        "/api/v1/me/course-ratings/1/details",
        headers=ALICE,
        json={"guest_names": [], "friend_user_ids": [], "guest_phone_numbers": ["+15551234567"]},
    )
    assert phone.status_code == 422
    with app.state.session_factory() as session:
        assert session.scalar(select(RoundCompanion.guest_name).where(RoundCompanion.guest_name.like("%555%"))) is None
        assert session.get(User, alice_id) is not None


def test_rating_validates_future_date_score_and_comparison_pair() -> None:
    client = TestClient(create_app())
    future = (date.today() + timedelta(days=1)).isoformat()
    assert client.put(
        "/api/v1/me/course-ratings/1", headers=ALICE, json=_rating(played_on=future)
    ).status_code == 422
    assert client.put(
        "/api/v1/me/course-ratings/1", headers=ALICE, json=_rating(score=39)
    ).status_code == 422
    assert client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json=_rating(comparison_course_id=2),
    ).status_code == 422


def test_ranking_routes_keep_rating_projections_and_aggregates_in_sync() -> None:
    app = create_app()
    client = TestClient(app)
    for course_id in (1, 2, 3):
        assert client.put(
            f"/api/v1/me/course-ratings/{course_id}", headers=ALICE, json=_rating()
        ).status_code == 200

    moved = client.put(
        "/api/v1/me/rankings/tiers",
        headers=ALICE,
        json={"assignments": [{"course_id": 1, "tier": "fairway"}]},
    )
    assert moved.status_code == 200
    course_one = client.get("/api/v1/me/course-ratings/1", headers=ALICE).json()
    assert (course_one["tier"], course_one["personal_rating"]) == ("fairway", 7.7)
    assert client.get("/api/v1/courses/1").json()["community_rating"] == 7.7

    compared = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=ALICE,
        json={"course_a_id": 2, "course_b_id": 3, "result": "course_b"},
    )
    assert compared.status_code == 200
    assert [entry["course"]["id"] for entry in compared.json()["entries"]] == [3, 2, 1]
    course_two = client.get("/api/v1/me/course-ratings/2", headers=ALICE).json()
    assert course_two["personal_rating"] == 8.5
    assert client.get("/api/v1/courses/2").json()["community_rating"] == 8.5

    unranked = client.put(
        "/api/v1/me/rankings/tiers",
        headers=ALICE,
        json={"assignments": [{"course_id": 2, "tier": "not_sure"}]},
    )
    assert unranked.status_code == 200
    state = client.get("/api/v1/me/course-ratings/2", headers=ALICE).json()
    assert state["personal_rating"] is None
    assert state["community_rating"] is None
    assert state["rating_count"] == 0
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count(Round.id)).where(Round.course_id == 2)) == 1


def test_rating_revision_preserves_same_tier_order_until_decisive_comparison() -> None:
    client = TestClient(create_app())
    for course_id in (1, 2, 3):
        client.put(f"/api/v1/me/course-ratings/{course_id}", headers=ALICE, json=_rating())

    score_only = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json=_rating(score=80, played_on="2026-07-02"),
    )
    assert score_only.status_code == 200
    ranking = client.get("/api/v1/me/rankings", headers=ALICE).json()
    assert [entry["course"]["id"] for entry in ranking["entries"]] == [1, 2, 3]

    for result in ("too_close", "not_sure"):
        response = client.put(
            "/api/v1/me/course-ratings/1",
            headers=ALICE,
            json=_rating(comparison_course_id=2, comparison_result=result),
        )
        assert response.status_code == 200
        ranking = client.get("/api/v1/me/rankings", headers=ALICE).json()
        assert [entry["course"]["id"] for entry in ranking["entries"]] == [1, 2, 3]

    decisive = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json=_rating(comparison_course_id=2, comparison_result="course_b"),
    )
    assert decisive.status_code == 200
    ranking = client.get("/api/v1/me/rankings", headers=ALICE).json()
    assert [entry["course"]["id"] for entry in ranking["entries"]] == [2, 1, 3]
