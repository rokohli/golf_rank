from fastapi.testclient import TestClient

from app.main import create_app


ALICE = {"X-Development-Subject": "dev:plan-alice"}
BOB = {"X-Development-Subject": "dev:plan-bob"}


def test_plan_hard_filters_and_uses_ranking_and_saved_signals() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=ALICE,
        json={"assignments": [
            {"course_id": 2, "tier": "loved_it"},
            {"course_id": 3, "tier": "liked_it"},
        ]},
    )
    saved_list = client.post(
        "/api/v1/me/saved-lists",
        headers=ALICE,
        json={"name": "Next", "visibility": "private"},
    ).json()
    client.put(
        f"/api/v1/me/saved-lists/{saved_list['id']}/courses/3",
        headers=ALICE,
        json={},
    )

    response = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Monterey weekend",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "max_green_fee": 500,
            "access": "public",
            "max_candidates": 5,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert all(item["course"]["green_fee"] <= 500 for item in body["candidates"])
    assert all(item["course"]["id"] != 1 for item in body["candidates"])
    assert body["candidates"][0]["course"]["id"] in {2, 3}
    assert all("availability" in item["caveats"][0].lower() for item in body["candidates"])
    assert len(body["itinerary"]) == 2

    plan_id = body["id"]
    assert client.get(f"/api/v1/me/plans/{plan_id}", headers=BOB).status_code == 404
    saved = client.post(f"/api/v1/me/plans/{plan_id}/save", headers=ALICE)
    assert saved.json()["status"] == "saved"
    regenerated = client.put(
        f"/api/v1/me/plans/{plan_id}",
        headers=ALICE,
        json={
            "title": "Monterey weekend updated",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "max_green_fee": 500,
            "access": "public",
        },
    )
    assert regenerated.json()["status"] == "draft"


def test_plan_radius_requires_origin_and_updates_regenerate_candidates() -> None:
    client = TestClient(create_app())
    invalid = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Invalid",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "radius_miles": 20,
        },
    )
    assert invalid.status_code == 422

    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Santa Cruz",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "regions": ["Santa Cruz, CA"],
        },
    )
    assert [item["course"]["id"] for item in created.json()["candidates"]] == [3]
    updated = client.put(
        f"/api/v1/me/plans/{created.json()['id']}",
        headers=ALICE,
        json={
            "title": "Monterey",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "regions": ["Monterey, CA"],
        },
    )
    assert {item["course"]["id"] for item in updated.json()["candidates"]} == {1, 2}
    assert all(item["distance_miles"] is not None for item in updated.json()["candidates"])
    assert all(
        any("destination center" in reason for reason in item["reasons"])
        for item in updated.json()["candidates"]
    )


def test_plan_destination_accepts_a_city_and_derives_its_origin() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Monterey",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey"],
        },
    )

    assert response.status_code == 201
    assert {item["course"]["id"] for item in response.json()["candidates"]} == {1, 2}
    assert all(item["distance_miles"] is not None for item in response.json()["candidates"])
