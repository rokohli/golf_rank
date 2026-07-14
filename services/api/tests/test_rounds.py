from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import create_app
from app.models import Round, RoundCompanion, RoundNote, UserCourseRating


ALICE = {"X-Development-Subject": "dev:round-alice"}
BOB = {"X-Development-Subject": "dev:round-bob"}


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


def test_deleting_rating_round_cascades_projection_companions_and_state() -> None:
    app = create_app()
    client = TestClient(app)
    rating = client.put(
        "/api/v1/me/course-ratings/1",
        headers=ALICE,
        json={"tier": "green", "played_on": "2026-07-01", "score": 82},
    )
    assert rating.status_code == 200
    round_id = rating.json()["round"]["id"]
    details = client.patch(
        "/api/v1/me/course-ratings/1/details",
        headers=ALICE,
        json={"guest_names": ["Guest Golfer"], "visibility": "private"},
    )
    assert details.status_code == 200

    deleted = client.delete(f"/api/v1/me/rounds/{round_id}", headers=ALICE)

    assert deleted.status_code == 204
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count(UserCourseRating.id))) == 0
        assert session.scalar(select(func.count(RoundCompanion.id))) == 0
    course = client.get("/api/v1/courses/1").json()
    assert course["community_rating"] is None
    assert course["rating_count"] == 0
    rating_state = client.get("/api/v1/me/course-ratings/1", headers=ALICE).json()
    assert rating_state["personal_rating"] is None
    assert rating_state["round"] is None
    assert client.get("/api/v1/me/course-states", headers=ALICE).json() == []
