from datetime import date
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.db import make_engine, make_session_factory
from app.models import (
    Base,
    Course,
    OnboardingPreference,
    Round,
    RoundCompanion,
    User,
    UserCourseRating,
)


def test_user_has_one_onboarding_preference() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        user = User(provider_subject="dev:alice")
        session.add(user)
        session.flush()

        session.add_all(
            [
                OnboardingPreference(user_id=user.id, max_green_fee=250, difficulty="any", access="any"),
                OnboardingPreference(user_id=user.id, max_green_fee=300, difficulty="challenging", access="public"),
            ]
        )

        with pytest.raises(IntegrityError):
            session.commit()


def test_current_rating_and_round_memories_persist_with_constraints() -> None:
    engine = make_engine("sqlite+pysqlite://")
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        course = Course(
            name="Pebble Beach Golf Links",
            region="Monterey, CA",
            latitude=36.568,
            longitude=-121.95,
            is_public=True,
            difficulty="challenging",
            green_fee=625,
        )
        other_course = Course(
            name="Spyglass Hill Golf Course",
            region="Monterey, CA",
            latitude=36.583,
            longitude=-121.959,
            is_public=True,
            difficulty="challenging",
            green_fee=495,
        )
        golfer = User(provider_subject="dev:golfer")
        friend = User(provider_subject="dev:friend")
        session.add_all([course, other_course, golfer, friend])
        session.flush()

        round_ = Round(
            user_id=golfer.id,
            course_id=course.id,
            played_on=date(2026, 7, 14),
            score=82,
            favorite_hole=7,
        )
        same_course_round = Round(
            user_id=golfer.id,
            course_id=course.id,
            played_on=date(2026, 7, 15),
        )
        other_round = Round(
            user_id=friend.id,
            course_id=other_course.id,
            played_on=date(2026, 7, 16),
        )
        session.add_all([round_, same_course_round, other_round])
        session.flush()

        rating = UserCourseRating(
            user_id=golfer.id,
            course_id=course.id,
            round_id=round_.id,
            tier="green",
            rating=9.2,
            confidence=0.85,
        )
        friend_companion = RoundCompanion(round_id=round_.id, friend_user_id=friend.id)
        guest_companion = RoundCompanion(round_id=round_.id, guest_name="Sam")
        session.add_all([rating, friend_companion, guest_companion])
        session.commit()

        assert session.get(Round, round_.id).favorite_hole == 7
        assert session.get(Round, round_.id).is_rating_round is False
        stored_rating = session.get(UserCourseRating, rating.id)
        assert stored_rating.tier == "green"
        assert stored_rating.rating == pytest.approx(9.2)
        assert stored_rating.confidence == pytest.approx(0.85)
        assert stored_rating.updated_at is not None
        assert session.get(RoundCompanion, friend_companion.id).friend_user_id == friend.id
        assert session.get(RoundCompanion, guest_companion.id).guest_name == "Sam"
        assert "phone" not in {
            column["name"] for column in inspect(engine).get_columns("round_companions")
        }

        session.add(
            UserCourseRating(
                user_id=golfer.id,
                course_id=course.id,
                round_id=same_course_round.id,
                tier="fairway",
                rating=7.5,
                confidence=0.5,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(
            UserCourseRating(
                user_id=golfer.id,
                course_id=other_course.id,
                round_id=other_round.id,
                tier="rough",
                rating=6.0,
                confidence=0.4,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(
            UserCourseRating(
                user_id=golfer.id,
                course_id=course.id,
                round_id=round_.id,
                tier="green",
                rating=9.0,
                confidence=0.9,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(RoundCompanion(round_id=round_.id, guest_name="Alex", friend_user_id=friend.id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(RoundCompanion(round_id=round_.id))
        with pytest.raises(IntegrityError):
            session.commit()


def test_rating_experience_migration_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database_path = tmp_path / "rating-experience.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    api_root = Path(__file__).parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))

    command.upgrade(config, "0004_product_domains")
    engine = make_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO users (id, provider_subject) VALUES (1, 'migration:test')")
        )
        connection.execute(
            text(
                """
                INSERT INTO courses
                    (id, name, region, latitude, longitude, is_public, difficulty, green_fee)
                VALUES
                    (1, 'Course 1', 'CA', 0, 0, 1, 'any', 1),
                    (2, 'Course 2', 'CA', 0, 0, 1, 'any', 1),
                    (3, 'Course 3', 'CA', 0, 0, 1, 'any', 1),
                    (4, 'Course 4', 'CA', 0, 0, 1, 'any', 1)
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO tier_assignments
                    (user_id, course_id, tier, ordinal_position)
                VALUES
                    (1, 1, 'loved_it', 1),
                    (1, 2, 'liked_it', 2),
                    (1, 3, 'fine', 3),
                    (1, 4, 'no', 4)
                """
            )
        )
    engine.dispose()

    command.upgrade(config, "0005_rating_experience")
    engine = make_engine(database_url)
    inspector = inspect(engine)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT tier FROM tier_assignments ORDER BY ordinal_position")
        ).scalars().all() == ["green", "fairway", "rough", "bunker"]
    round_columns = {column["name"]: column for column in inspector.get_columns("rounds")}
    assert "favorite_hole" in round_columns
    assert round_columns["is_rating_round"]["nullable"] is False
    assert round_columns["is_rating_round"]["default"] is not None
    assert {"user_course_ratings", "round_companions"}.issubset(inspector.get_table_names())
    assert "uq_round_id_user_course" in {
        constraint["name"] for constraint in inspector.get_unique_constraints("rounds")
    }
    ownership_fk = next(
        foreign_key
        for foreign_key in inspector.get_foreign_keys("user_course_ratings")
        if foreign_key["name"] == "fk_user_course_rating_round_owner"
    )
    assert ownership_fk["constrained_columns"] == ["round_id", "user_id", "course_id"]
    assert ownership_fk["referred_columns"] == ["id", "user_id", "course_id"]
    assert "ix_user_course_ratings_round_id" not in {
        index["name"] for index in inspector.get_indexes("user_course_ratings")
    }
    assert "phone" not in {
        column["name"] for column in inspector.get_columns("round_companions")
    }
    engine.dispose()

    command.downgrade(config, "0004_product_domains")
    engine = make_engine(database_url)
    inspector = inspect(engine)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT tier FROM tier_assignments ORDER BY ordinal_position")
        ).scalars().all() == ["loved_it", "liked_it", "fine", "no"]
    round_column_names = {column["name"] for column in inspector.get_columns("rounds")}
    assert "favorite_hole" not in round_column_names
    assert "is_rating_round" not in round_column_names
    assert {"user_course_ratings", "round_companions"}.isdisjoint(inspector.get_table_names())
    engine.dispose()


def test_legacy_seed_course_facts_are_backfilled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database_path = tmp_path / "legacy-seed-course.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    api_root = Path(__file__).parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))

    command.upgrade(config, "0010_course_detail_enrichment")
    engine = make_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text(
            """
            INSERT INTO courses
                (id, name, region, latitude, longitude, source, source_course_id,
                 country_code, status, par, slope_rating, tee_time_url)
            VALUES
                (1, 'Pebble Beach Golf Links', 'Monterey, CA', 36.568, -121.949,
                 'seed', NULL, 'US', 'active', NULL, NULL, NULL),
                (2, 'Spyglass Hill Golf Course', 'Monterey, CA', 36.585, -121.942,
                 'seed', 'spyglass', 'US', 'active', 72, 145,
                 'https://www.pebblebeach.com/plan-my-trip/preview-availability/')
            """
        ))
    engine.dispose()

    command.upgrade(config, "head")
    engine = make_engine(database_url)
    with engine.connect() as connection:
        row = connection.execute(text(
            """
            SELECT source_course_id, hole_count, par, slope_rating, tee_time_url
            FROM courses WHERE id = 1
            """
        )).one()

    assert row.source_course_id == "pebble"
    assert row.hole_count == 18
    assert row.par == 72
    assert row.slope_rating == 145
    assert row.tee_time_url.startswith("https://www.pebblebeach.com/")
    engine.dispose()

    command.downgrade(config, "0010_course_detail_enrichment")
    engine = make_engine(database_url)
    with engine.connect() as connection:
        rows = connection.execute(text(
            """
            SELECT source_course_id, par, slope_rating, tee_time_url
            FROM courses WHERE id IN (1, 2) ORDER BY id
            """
        )).all()

    assert rows[0].source_course_id == "pebble"
    assert rows[0].par == 72
    assert rows[0].slope_rating == 145
    assert rows[0].tee_time_url.startswith("https://www.pebblebeach.com/")
    assert rows[1].source_course_id == "spyglass"
    assert rows[1].par == 72
    assert rows[1].slope_rating == 145
    assert rows[1].tee_time_url.startswith("https://www.pebblebeach.com/")
    engine.dispose()


def test_provider_first_catalog_preserves_stable_ids_and_curated_facts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "provider-first-catalog.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    api_root = Path(__file__).parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))

    command.upgrade(config, "0012_data_api_hardening")
    engine = make_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text(
            """
            INSERT INTO courses
                (id, name, region, latitude, longitude, is_public, difficulty,
                 green_fee, source, source_course_id, country_code, admin1_code,
                 admin1_name, city, course_name, status, hole_count, par,
                 slope_rating, tee_time_url, access)
            VALUES
                (1, 'Pebble Beach Golf Links', 'Monterey, CA', 36.568, -121.949,
                 1, 'challenging', 675, 'seed', 'pebble', 'US', 'CA',
                 'California', 'Monterey', 'Pebble Beach Golf Links', 'active',
                 18, 72, 145, 'https://seed.example/pebble', 'public'),
                (2, 'Spyglass Hill Golf Course', 'Monterey, CA', 36.585, -121.942,
                 1, 'challenging', 495, 'seed', 'spyglass', 'US', 'CA',
                 'California', 'Monterey', 'Spyglass Hill Golf Course', 'active',
                 18, 72, 145, 'https://seed.example/spyglass', 'public'),
                (3, 'Pasatiempo Golf Club', 'Santa Cruz, CA', 37.004, -121.998,
                 1, 'challenging', 410, 'seed', 'pasatiempo', 'US', 'CA',
                 'California', 'Santa Cruz', 'Pasatiempo Golf Club', 'active',
                 18, 70, 141, 'https://seed.example/pasatiempo', 'public'),
                (687, 'Pebble Beach Golf Links', 'Pebble Beach, CA', 36.568,
                 -121.949, 1, NULL, NULL, 'opengolfapi',
                 '40977ee8-33ee-4195-b6a2-99a4ca83c2bc', 'US', 'CA',
                 'California', 'Pebble Beach', 'Pebble Beach Golf Links',
                 'active', 18, 72, NULL, NULL, 'public'),
                (919, 'Spyglass Hill Golf Course', 'Pebble Beach, CA', 36.585,
                 -121.942, 0, NULL, NULL, 'opengolfapi',
                 '315fb576-129c-4508-abfa-561d8fbf2904', 'US', 'CA',
                 'California', 'Pebble Beach', 'Spyglass Hill Golf Course',
                 'active', 18, 72, NULL, NULL, 'resort'),
                (682, 'Pasatiempo Golf Club', 'Santa Cruz, CA', 37.004,
                 -121.998, 0, NULL, NULL, 'opengolfapi',
                 '99f368a1-ea6a-403a-baca-ca235cb657cf', 'US', 'CA',
                 'California', 'Santa Cruz', 'Pasatiempo Golf Club',
                 'active', 18, 70, NULL, NULL, 'private')
            """
        ))
        connection.execute(text(
            "INSERT INTO users (id, provider_subject) VALUES (1, 'test:golfer')"
        ))
        connection.execute(text(
            """
            INSERT INTO rounds (id, user_id, course_id, played_on, visibility)
            VALUES (1, 1, 1, '2026-07-22', 'private')
            """
        ))
    engine.dispose()

    command.upgrade(config, "head")

    def assert_provider_first_state() -> None:
        migrated_engine = make_engine(database_url)
        with migrated_engine.connect() as connection:
            rows = connection.execute(text(
                """
                SELECT id, source_course_id, city, access, difficulty, green_fee,
                       slope_rating, tee_time_url
                FROM courses
                WHERE id IN (1, 2, 3, 682, 687, 919)
                ORDER BY id
                """
            )).mappings().all()
            seed_count = connection.scalar(text(
                "SELECT COUNT(*) FROM courses WHERE source = 'seed'"
            ))
            reconciliation_count = connection.scalar(text(
                "SELECT COUNT(*) FROM course_reconciliations"
            ))
            round_course_id = connection.scalar(text(
                "SELECT course_id FROM rounds WHERE id = 1"
            ))

        assert [row["id"] for row in rows] == [1, 2, 3]
        assert [row["source_course_id"] for row in rows] == [
            "40977ee8-33ee-4195-b6a2-99a4ca83c2bc",
            "315fb576-129c-4508-abfa-561d8fbf2904",
            "99f368a1-ea6a-403a-baca-ca235cb657cf",
        ]
        assert [row["city"] for row in rows] == [
            "Pebble Beach", "Pebble Beach", "Santa Cruz"
        ]
        assert [row["access"] for row in rows] == ["public", "resort", "private"]
        assert [row["difficulty"] for row in rows] == ["challenging"] * 3
        assert [row["green_fee"] for row in rows] == [675, 495, 410]
        assert [row["slope_rating"] for row in rows] == [145, 145, 141]
        assert [row["tee_time_url"] for row in rows] == [
            "https://seed.example/pebble",
            "https://seed.example/spyglass",
            "https://seed.example/pasatiempo",
        ]
        assert seed_count == 0
        assert reconciliation_count == 0
        assert round_course_id == 1
        migrated_engine.dispose()

    assert_provider_first_state()
    command.downgrade(config, "0013_canonical_course_identity")
    assert_provider_first_state()
    command.upgrade(config, "head")
    assert_provider_first_state()


def test_provider_first_catalog_rejects_conflicting_manual_mapping(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "provider-first-conflict.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    api_root = Path(__file__).parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))

    command.upgrade(config, "0012_data_api_hardening")
    engine = make_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text(
            """
            INSERT INTO courses
                (id, name, region, latitude, longitude, is_public, difficulty,
                 green_fee, source, source_course_id, country_code, status)
            VALUES
                (2, 'Spyglass Hill Golf Course', 'Monterey, CA', 36.585,
                 -121.942, 1, 'challenging', 495, 'seed', 'spyglass', 'US',
                 'active'),
                (4, 'Manual Canonical Course', 'Monterey, CA', 36.600,
                 -121.900, 1, 'moderate', 200, 'manual', 'manual-canonical',
                 'US', 'active'),
                (919, 'Spyglass Hill Golf Course', 'Pebble Beach, CA', 36.585,
                 -121.942, 0, NULL, NULL, 'opengolfapi',
                 '315fb576-129c-4508-abfa-561d8fbf2904', 'US', 'active')
            """
        ))
        connection.execute(text(
            """
            INSERT INTO course_reconciliations
                (source, source_course_id, canonical_course_id, match_status,
                 match_data)
            VALUES
                ('opengolfapi', '315fb576-129c-4508-abfa-561d8fbf2904', 4,
                 'confirmed', '{"source":"manual-review"}')
            """
        ))
    engine.dispose()

    with pytest.raises(RuntimeError, match="conflicts with an explicit canonical mapping"):
        command.upgrade(config, "head")

    engine = make_engine(database_url)
    with engine.connect() as connection:
        courses = connection.execute(text(
            "SELECT id, source FROM courses WHERE id IN (2, 919) ORDER BY id"
        )).all()
        canonical_course_id = connection.scalar(text(
            """
            SELECT canonical_course_id
            FROM course_reconciliations
            WHERE source = 'opengolfapi'
              AND source_course_id = '315fb576-129c-4508-abfa-561d8fbf2904'
            """
        ))

    assert courses == [(2, "seed"), (919, "opengolfapi")]
    assert canonical_course_id == 4
    engine.dispose()


def test_ai_plan_generation_migration_round_trip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "ai-plan-generations.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    api_root = Path(__file__).parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))

    command.upgrade(config, "head")
    engine = make_engine(database_url)
    inspector = inspect(engine)
    assert "plan_generations" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("plan_generations")}
    assert {
        "plan_id",
        "status",
        "provider",
        "model_identifier",
        "prompt_version",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "estimated_cost_micros",
        "fallback_reason",
        "generated_summary",
    } <= columns
    assert {index["name"] for index in inspector.get_indexes("plan_generations")} == {
        "ix_plan_generations_plan_id",
        "ix_plan_generations_status",
    }
    engine.dispose()

    command.downgrade(config, "0014_provider_first_catalog")
    engine = make_engine(database_url)
    assert "plan_generations" not in inspect(engine).get_table_names()
    engine.dispose()
