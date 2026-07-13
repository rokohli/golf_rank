from fastapi.testclient import TestClient

from app.main import create_app


ALICE = {"X-Development-Subject": "dev:saves-alice"}
BOB = {"X-Development-Subject": "dev:saves-bob"}


def test_saved_lists_are_owned_defaulted_and_idempotent() -> None:
    client = TestClient(create_app())
    created = client.post(
        "/api/v1/me/saved-lists",
        headers=ALICE,
        json={"name": "Dream courses", "visibility": "friends"},
    )
    assert created.status_code == 201
    list_id = created.json()["id"]
    assert created.json()["is_default"] is True

    first_save = client.put(
        f"/api/v1/me/saved-lists/{list_id}/courses/1",
        headers=ALICE,
        json={"note": "Play at sunset"},
    )
    second_save = client.put(
        f"/api/v1/me/saved-lists/{list_id}/courses/1",
        headers=ALICE,
        json={"note": "Bring a sweater"},
    )
    assert first_save.status_code == 200
    assert len(second_save.json()["courses"]) == 1
    assert second_save.json()["courses"][0]["note"] == "Bring a sweater"

    assert client.patch(
        f"/api/v1/me/saved-lists/{list_id}", headers=BOB, json={"name": "Stolen"}
    ).status_code == 404

    removed = client.delete(
        f"/api/v1/me/saved-lists/{list_id}/courses/1", headers=ALICE
    )
    assert removed.status_code == 204
    assert client.get("/api/v1/me/saved-lists", headers=ALICE).json()[0]["courses"] == []


def test_duplicate_list_names_are_rejected_per_user() -> None:
    client = TestClient(create_app())
    payload = {"name": "Weekend", "visibility": "private"}
    assert client.post("/api/v1/me/saved-lists", headers=ALICE, json=payload).status_code == 201
    assert client.post("/api/v1/me/saved-lists", headers=ALICE, json=payload).status_code == 409
