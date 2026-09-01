from pathlib import Path
from tempfile import NamedTemporaryFile

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.db import make_engine


def _alembic_config(monkeypatch: pytest.MonkeyPatch, db_url: str) -> Config:
    monkeypatch.setenv("DATABASE_URL", db_url)
    api_root = Path(__file__).resolve().parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    return config


def test_full_migration_upgrade_and_downgrade_cycle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that the full migration graph can upgrade to head, step back to base, and re-upgrade without errors."""
    with NamedTemporaryFile(suffix=".db") as tmp:
        db_url = f"sqlite:///{tmp.name}"
        config = _alembic_config(monkeypatch, db_url)

        # 1. Upgrade from clean state to head
        command.upgrade(config, "head")

        engine = make_engine(db_url)
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert "users" in tables
        assert "profiles" in tables
        assert "tier_assignments" in tables
        assert "onboarding_preferences" in tables
        assert "deleted_identities" in tables

        # Verify columns introduced in recent migrations
        profile_columns = {col["name"] for col in inspector.get_columns("profiles")}
        assert "username" in profile_columns

        tier_columns = {col["name"] for col in inspector.get_columns("tier_assignments")}
        assert "is_incomplete" in tier_columns

        course_image_columns = {col["name"] for col in inspector.get_columns("course_images")}
        assert "license_name" in course_image_columns
        assert "license_url" in course_image_columns
        engine.dispose()

        # 2. Downgrade 0021, 0020, 0019, and 0018 step by step
        command.downgrade(config, "0020_cascade_delete_user_rows")
        engine = make_engine(db_url)
        inspector = inspect(engine)
        assert "deleted_identities" not in set(inspector.get_table_names())
        course_image_cols_after_0021 = {col["name"] for col in inspector.get_columns("course_images")}
        assert "license_name" not in course_image_cols_after_0021
        engine.dispose()

        command.downgrade(config, "0019_incomplete_tier_assignments")
        engine = make_engine(db_url)
        engine.dispose()

        command.downgrade(config, "0018_unique_profile_usernames")
        engine = make_engine(db_url)
        inspector = inspect(engine)
        tier_columns_after_0019_downgrade = {col["name"] for col in inspector.get_columns("tier_assignments")}
        assert "is_incomplete" not in tier_columns_after_0019_downgrade
        engine.dispose()

        command.downgrade(config, "0017_remove_profile_visibility")
        engine = make_engine(db_url)
        inspector = inspect(engine)
        profile_columns_after_0018_downgrade = {col["name"] for col in inspector.get_columns("profiles")}
        assert "username" not in profile_columns_after_0018_downgrade
        engine.dispose()

        # 3. Downgrade to base
        command.downgrade(config, "base")

        # 4. Re-upgrade cleanly to head
        command.upgrade(config, "head")
        engine = make_engine(db_url)
        inspector = inspect(engine)
        assert "is_incomplete" in {col["name"] for col in inspector.get_columns("tier_assignments")}
        assert "username" in {col["name"] for col in inspector.get_columns("profiles")}
        assert "deleted_identities" in set(inspector.get_table_names())
        assert "license_name" in {col["name"] for col in inspector.get_columns("course_images")}
        engine.dispose()


def test_0018_migration_preserves_clean_usernames_and_sanitizes_dirty_ones(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that migration 0018 handles legacy dirty usernames deterministically."""
    with NamedTemporaryFile(suffix=".db") as tmp:
        db_url = f"sqlite:///{tmp.name}"
        config = _alembic_config(monkeypatch, db_url)

        # Upgrade up to 0017
        command.upgrade(config, "0017_remove_profile_visibility")

        engine = make_engine(db_url)
        with engine.begin() as conn:
            # Seed legacy rows
            conn.execute(text("INSERT INTO users (id, provider_subject) VALUES (1, 'dev:clean'), (2, 'dev:dirty'), (3, 'dev:collision')"))
            conn.execute(text("INSERT INTO profiles (user_id, home_region) VALUES (1, 'Monterey, CA'), (2, 'Santa Cruz, CA'), (3, 'San Jose, CA')"))
            for uid, data in [
                (1, '{"first_name": "Alice", "last_name": "A", "username": "golf_pro"}'),
                (2, '{"first_name": "Bob", "last_name": "B", "username": "@golf-pro!"}'),
                (3, '{"first_name": "Charlie", "last_name": "C", "username": "golf_pro"}'),
            ]:
                conn.execute(
                    text("INSERT INTO onboarding_preferences (user_id, max_green_fee, difficulty, access, onboarding_data) VALUES (:uid, 200, 'any', 'any', :data)"),
                    {"uid": uid, "data": data},
                )
        engine.dispose()

        # Upgrade through 0018
        command.upgrade(config, "0018_unique_profile_usernames")

        engine = make_engine(db_url)
        with engine.connect() as conn:
            profiles = dict(conn.execute(text("SELECT user_id, username FROM profiles ORDER BY user_id")).all())
            # Clean user 1 gets 'golf_pro'
            assert profiles[1] == "golf_pro"
            # Dirty user 2 sanitized 'golfpro'
            assert profiles[2] == "golfpro"
            # Conflicting user 3 gets deterministic suffix
            assert profiles[3] == "golf_pro_3"
        engine.dispose()
