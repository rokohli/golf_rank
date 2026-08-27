import threading
from concurrent.futures import ThreadPoolExecutor

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.core.config import Settings
from app.main import create_app
from app.models import Course
from app.ranking import _lock_user_for_ranking_update


def test_lock_user_for_ranking_update_emits_for_update_on_postgres() -> None:
    """SQLite silently drops FOR UPDATE, so the concurrency test below can't detect
    a deleted `.with_for_update()` call -- only that the statement `_lock_user_for_
    ranking_update` actually issues still requests a row lock, compiled against the
    dialect that honors it.
    """
    captured: list = []

    class _RecordingSession:
        def execute(self, statement):
            captured.append(statement)

    _lock_user_for_ranking_update(_RecordingSession(), 1)

    assert len(captured) == 1
    compiled = str(captured[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in compiled


def test_concurrency_locks_in_ranking_comparisons_and_tier_placements(tmp_path: Path) -> None:
    """Verify that multiple ranking operations serialize correctly without duplicate snapshots or integrity errors.

    Requests are fired from a thread pool with a barrier so they actually overlap in
    flight, rather than being issued one at a time -- a purely sequential test can't
    tell the difference between the lock working and the lock being deleted entirely.
    A file-backed database (rather than the shared in-memory default) is required so
    each thread gets its own real connection instead of racing on one DBAPI cursor.
    """
    db_path = tmp_path / "concurrency.db"
    app = create_app(Settings(database_url=f"sqlite+pysqlite:///{db_path}"))
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

    # Concurrent comparison submissions: a barrier holds every worker until all of
    # them are ready to fire, so the requests genuinely overlap instead of the
    # thread pool effectively serializing them for us.
    outcomes = ["course_a", "course_b", "too_close", "course_a", "course_b"]
    barrier = threading.Barrier(len(outcomes))

    def submit(outcome: str):
        barrier.wait()
        return client.post(
            "/api/v1/me/rankings/comparisons",
            headers=headers,
            json={"course_a_id": 1, "course_b_id": 2, "result": outcome},
        )

    with ThreadPoolExecutor(max_workers=len(outcomes)) as pool:
        responses = list(pool.map(submit, outcomes))

    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    # Serialized writes must hand out every version exactly once -- a broken lock
    # surfaces here as a lost update (a repeated version) or a unique-constraint
    # failure on the (user_id, version) snapshot row.
    versions = sorted(r.json()["version"] for r in responses)
    assert versions == [2, 3, 4, 5, 6]

    final_ranking = client.get("/api/v1/me/rankings", headers=headers).json()
    assert len(final_ranking["entries"]) == 3
    assert final_ranking["version"] == 6

    # Successive tier updates also serialize and advance version monotonically
    tier_update = client.put(
        "/api/v1/me/rankings/tiers",
        headers=headers,
        json={
            "assignments": [
                {"course_id": 1, "tier": "green", "position": 1},
            ]
        },
    )
    assert tier_update.status_code == 200
    assert tier_update.json()["version"] == 7

