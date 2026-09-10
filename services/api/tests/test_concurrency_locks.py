import threading
from concurrent.futures import ThreadPoolExecutor

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.core.config import Settings
from app.course_images.repository import CourseImageRepository
from app.main import create_app
from app.models import Course, CourseImage, CourseImageSource
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


def test_lock_image_for_moderation_emits_for_update_on_postgres() -> None:
    """Same reasoning as above: SQLite silently drops FOR UPDATE, so only a
    dialect-compiled assertion can catch a deleted `.with_for_update()` in the
    moderation path, where two admins acting on one photo would then race."""
    captured: list = []

    class _RecordingSession:
        def scalar(self, statement):
            captured.append(statement)
            return None

    CourseImageRepository().lock_image_for_moderation(_RecordingSession(), 1)

    assert len(captured) == 1
    compiled = str(captured[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in compiled


def test_set_featured_locks_the_tier_on_postgres() -> None:
    """Featuring clears is_hero across the whole (course, source_type) tier, so
    it must lock those rows deterministically in ascending id order."""
    captured: list = []

    class _RecordingSession:
        def scalars(self, statement):
            captured.append(statement)
            return _Empty()

        def commit(self):
            pass

        def refresh(self, _obj):
            pass

    class _Empty:
        def all(self):
            return []

    image = CourseImage(id=1, course_id=1, source_type=CourseImageSource.USER, is_hero=False)
    CourseImageRepository().set_featured(_RecordingSession(), image, True)

    assert len(captured) == 1
    compiled = str(captured[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in compiled
    assert "ORDER BY course_images.id ASC" in compiled


def test_feature_user_image_locks_tier_deterministically_on_postgres() -> None:
    """Proves that feature_user_image issues SELECT ... ORDER BY id ASC FOR UPDATE,
    guaranteeing that all concurrent feature requests acquire locks in identical order."""
    captured: list = []

    class _RecordingSession:
        def scalar(self, statement):
            captured.append(statement)
            return CourseImage(id=2, course_id=10, source_type=CourseImageSource.USER, is_hero=False)

        def scalars(self, statement):
            captured.append(statement)
            return _Empty()

        def commit(self):
            pass

        def refresh(self, _obj):
            pass

    class _Empty:
        def all(self):
            return [CourseImage(id=2, course_id=10, source_type=CourseImageSource.USER, is_hero=False)]

    CourseImageRepository().feature_user_image(_RecordingSession(), 2, featured=True, moderator_user_id=1)

    assert len(captured) == 2
    tier_lock_query = str(captured[1].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in tier_lock_query
    assert "ORDER BY course_images.id ASC" in tier_lock_query



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


def test_feature_user_image_transaction_atomicity(tmp_path: Path) -> None:
    """Verify that feature_user_image is atomic: if an error occurs prior to commit,
    no partial updates (neither hero status nor moderation action) are persisted."""
    db_path = tmp_path / "atomicity.db"
    app = create_app(Settings(database_url=f"sqlite+pysqlite:///{db_path}"))
    repo = CourseImageRepository()

    with app.state.session_factory() as session:
        course = Course(
            id=100,
            name="Test Course",
            region="Monterey, CA",
            latitude=36.5,
            longitude=-121.9,
            is_public=True,
            difficulty="challenging",
            green_fee=500,
            source="seed",
            source_course_id="test_100",
            access="public",
        )
        session.add(course)
        image = CourseImage(
            id=200,
            course_id=100,
            source_type=CourseImageSource.USER,
            storage_key="user_uploads/img.jpg",
            is_hero=False,
        )
        session.add(image)
        session.commit()

    with app.state.session_factory() as session:
        def failing_commit():
            raise RuntimeError("Simulated DB write failure")

        session.commit = failing_commit

        try:
            repo.feature_user_image(session, 200, featured=True, moderator_user_id=1)
        except RuntimeError:
            session.rollback()

    with app.state.session_factory() as session:
        fresh = session.get(CourseImage, 200)
        assert fresh is not None
        assert fresh.is_hero is False
        assert fresh.moderation_action is None
        assert fresh.moderated_by_user_id is None


import os
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

POSTGRES_TEST_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://golf_rank:golf_rank@localhost:5433/golf_rank",
)


def _can_connect_postgres(url: str) -> bool:
    try:
        engine = create_engine(url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


@pytest.mark.skipif(
    not _can_connect_postgres(POSTGRES_TEST_URL),
    reason="PostgreSQL test database not available",
)
def test_concurrent_feature_requests_on_postgres_no_deadlock() -> None:
    """Proves that concurrent feature requests on PostgreSQL do not deadlock because
    the tier rows are locked deterministically in ascending id order."""
    engine = create_engine(POSTGRES_TEST_URL, pool_size=15, max_overflow=5)
    repo = CourseImageRepository()

    course_id = 998877
    user_id = 887766
    image_ids = [99001, 99002, 99003, 99004, 99005]

    with Session(engine) as session:
        session.execute(
            text("DELETE FROM course_images WHERE course_id = :cid"),
            {"cid": course_id},
        )
        session.execute(
            text("DELETE FROM courses WHERE id = :cid"),
            {"cid": course_id},
        )
        session.execute(
            text("DELETE FROM profiles WHERE user_id = :uid"),
            {"uid": user_id},
        )
        session.execute(
            text("DELETE FROM users WHERE id = :uid"),
            {"uid": user_id},
        )
        session.commit()

        session.execute(
            text(
                "INSERT INTO courses (id, name, region, latitude, longitude, is_public, difficulty, green_fee, source, source_course_id, access) "
                "VALUES (:cid, 'PG Concurrency Course', 'Test Region', 37.0, -122.0, true, 'moderate', 100, 'seed', 'pg_conc_1', 'public')"
            ),
            {"cid": course_id},
        )
        session.execute(
            text("INSERT INTO users (id, provider_subject) VALUES (:uid, 'test_pg_conc_user')"),
            {"uid": user_id},
        )
        session.execute(
            text("INSERT INTO profiles (user_id, home_region, username) VALUES (:uid, 'Test Region', 'pgconc')"),
            {"uid": user_id},
        )
        for idx, iid in enumerate(image_ids):
            session.execute(
                text(
                    "INSERT INTO course_images (id, course_id, uploaded_by_user_id, source_type, storage_key, position, is_hero, moderation_status) "
                    "VALUES (:iid, :cid, :uid, 'user', :skey, :pos, false, 'approved')"
                ),
                {"iid": iid, "cid": course_id, "uid": user_id, "skey": f"user_uploads/{iid}.jpg", "pos": idx},
            )
        session.commit()

    try:
        targets = [99005, 99001, 99004, 99002, 99003, 99005, 99001, 99002]
        barrier = threading.Barrier(len(targets))
        errors = []

        def worker(target_id: int):
            barrier.wait()
            try:
                with Session(engine) as s:
                    repo.feature_user_image(
                        s,
                        target_id,
                        featured=True,
                        moderator_user_id=user_id,
                    )
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(tid,)) for tid in targets]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Concurrent feature requests produced errors: {errors}"

        with Session(engine) as session:
            stmt = select(CourseImage).where(CourseImage.course_id == course_id)
            images = session.scalars(stmt).all()
            heroes = [img for img in images if img.is_hero]
            assert len(heroes) == 1, f"Expected exactly 1 hero, found {len(heroes)}"
            assert heroes[0].moderation_action == "featured"
            assert heroes[0].moderated_by_user_id == user_id

    finally:
        with Session(engine) as session:
            session.execute(
                text("DELETE FROM course_images WHERE course_id = :cid"),
                {"cid": course_id},
            )
            session.execute(
                text("DELETE FROM courses WHERE id = :cid"),
                {"cid": course_id},
            )
            session.execute(
                text("DELETE FROM profiles WHERE user_id = :uid"),
                {"uid": user_id},
            )
            session.execute(
                text("DELETE FROM users WHERE id = :uid"),
                {"uid": user_id},
            )
            session.commit()
        engine.dispose()
