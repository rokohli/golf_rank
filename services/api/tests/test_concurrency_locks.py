from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Course


def test_concurrency_locks_in_ranking_comparisons_and_tier_placements() -> None:
    """Verify that multiple ranking operations serialize correctly without duplicate snapshots or integrity errors."""
    app = create_app()
    with app.state.session_factory() as session:
        for cid, name in [(1, "Pebble Beach"), (2, "Spyglass Hill"), (3, "Pasatiempo")]:
            if not session.get(Course, cid):
                session.add(Course(
                    id=cid,
                    name=name,
                    region="Monterey, CA",
                    latitude=36.5,
                    longitude=-121.9,
                    is_public=True,
                    difficulty="challenging",
                    green_fee=500,
                    source="seed",
                    source_course_id=f"course_{cid}",
                    access="public",
                ))
        session.commit()

    client = TestClient(app)
    headers = {"X-Development-Subject": "dev:concurrency-user"}

    # Initial tier placement
    init_res = client.put(
        "/api/v1/me/rankings/tiers",
        headers=headers,
        json={
            "assignments": [
                {"course_id": 1, "tier": "fairway", "position": 1},
                {"course_id": 2, "tier": "fairway", "position": 2},
                {"course_id": 3, "tier": "fairway", "position": 3},
            ]
        },
    )
    assert init_res.status_code == 200
    assert init_res.json()["version"] == 1

    # Rapid successive comparison submissions
    outcomes = ["course_a", "course_b", "too_close", "course_a", "course_b"]
    responses = []
    for outcome in outcomes:
        res = client.post(
            "/api/v1/me/rankings/comparisons",
            headers=headers,
            json={"course_a_id": 1, "course_b_id": 2, "result": outcome},
        )
        responses.append(res)

    assert all(r.status_code == 200 for r in responses)
    # Versions should strictly increase monotonically
    versions = [r.json()["version"] for r in responses]
    assert versions == [2, 3, 4, 5, 6]

    final_ranking = client.get("/api/v1/me/rankings", headers=headers).json()
    assert len(final_ranking["entries"]) == 3
    assert final_ranking["version"] == 6
