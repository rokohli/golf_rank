from fastapi.testclient import TestClient

from app.main import create_app
from app.models import RoundNote


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
