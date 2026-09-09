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


def test_0024_migration_shares_fleming_storage_key_with_harding(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression test for two 0024 bugs: (1) fleming_hero["source_url"] raised
    a KeyError because the lightweight course_images table declaration didn't
    include that column: (2) the inserted Harding row pointed at a fabricated
    storage_key no R2 object was ever copied to. The fix reuses Fleming's
    actual storage_key/source_url instead."""
    with NamedTemporaryFile(suffix=".db") as tmp:
        db_url = f"sqlite:///{tmp.name}"
        config = _alembic_config(monkeypatch, db_url)

        command.upgrade(config, "0023_course_image_round_link")

        engine = make_engine(db_url)
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO courses (id, name, region, source, source_course_id, latitude, longitude) VALUES "
                "(1, 'Tpc Harding Park Fleming Course', 'SF', 'seed', "
                "'61fb03c8-74fc-4fc8-87d0-0491190e2d54', 37.7, -122.5), "
                "(2, 'Tpc Harding Park Harding Course', 'SF', 'seed', "
                "'21922834-62d3-4603-b624-b44867b60eb4', 37.7, -122.5)"
            ))
            conn.execute(text(
                "INSERT INTO course_images (course_id, storage_key, alt_text, source_name, source_url, "
                "position, is_hero, source_type, moderation_status) VALUES "
                "(1, 'courses/1/hero.jpg', 'Fleming hero', 'GolfRank photographer', "
                "'https://golfrank.example/photos/fleming', 0, 1, 'official', 'approved')"
            ))
        engine.dispose()

        # Must not raise -- this is where the missing source_url column
        # declaration used to blow up with a KeyError.
        command.upgrade(config, "0024_fix_course_photos")

        engine = make_engine(db_url)
        with engine.connect() as conn:
            harding = conn.execute(text(
                "SELECT storage_key, source_url FROM course_images WHERE course_id = 2"
            )).one()
            assert harding[0] == "courses/1/hero.jpg"
            assert harding[1] == "https://golfrank.example/photos/fleming"
        engine.dispose()


def test_0024_migration_shifts_hardings_existing_row_out_of_position_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression test: if Harding already has a row at position 0 (e.g. a
    Wikimedia fallback the app cached before this migration ran), inserting
    the shared Fleming hero at a hardcoded position=0 violates
    uq_course_image_position and aborts the whole upgrade. The fix shifts
    Harding's existing rows out of the way first, mirroring the Presidio
    section earlier in the same migration."""
    with NamedTemporaryFile(suffix=".db") as tmp:
        db_url = f"sqlite:///{tmp.name}"
        config = _alembic_config(monkeypatch, db_url)

        command.upgrade(config, "0023_course_image_round_link")

        engine = make_engine(db_url)
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO courses (id, name, region, source, source_course_id, latitude, longitude) VALUES "
                "(1, 'Tpc Harding Park Fleming Course', 'SF', 'seed', "
                "'61fb03c8-74fc-4fc8-87d0-0491190e2d54', 37.7, -122.5), "
                "(2, 'Tpc Harding Park Harding Course', 'SF', 'seed', "
                "'21922834-62d3-4603-b624-b44867b60eb4', 37.7, -122.5)"
            ))
            conn.execute(text(
                "INSERT INTO course_images (course_id, storage_key, alt_text, source_name, source_url, "
                "position, is_hero, source_type, moderation_status) VALUES "
                "(1, 'courses/1/hero.jpg', 'Fleming hero', 'GolfRank photographer', "
                "'https://golfrank.example/photos/fleming', 0, 1, 'official', 'approved')"
            ))
            # Harding already has a row at position 0, pre-migration --
            # exactly the collision the fix must avoid.
            conn.execute(text(
                "INSERT INTO course_images (course_id, external_url, position, is_hero, source_type, "
                "moderation_status) VALUES "
                "(2, 'https://wikimedia.example/harding.jpg', 0, 1, 'wikimedia', 'approved')"
            ))
        engine.dispose()

        # Must not raise -- this is where the hardcoded position=0 used to
        # collide with Harding's pre-existing row and abort the upgrade.
        command.upgrade(config, "0024_fix_course_photos")

        engine = make_engine(db_url)
        with engine.connect() as conn:
            harding_positions = [row[0] for row in conn.execute(text(
                "SELECT position FROM course_images WHERE course_id = 2 ORDER BY position"
            )).all()]
            assert len(harding_positions) == len(set(harding_positions)), "duplicate positions"
            assert harding_positions[0] == 0
        engine.dispose()


def test_0025_storage_key_uniqueness_is_partial_on_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    """uq_course_image_user_storage_key must only constrain USER rows -- two
    OFFICIAL rows sharing one storage_key (migration 0024's Fleming/Harding
    shared hero) must remain insertable, while two USER rows sharing a key
    must still be rejected. Without sqlite_where this index becomes a global
    unique constraint on SQLite (postgresql_where is silently ignored there),
    breaking the first case."""
    with NamedTemporaryFile(suffix=".db") as tmp:
        db_url = f"sqlite:///{tmp.name}"
        config = _alembic_config(monkeypatch, db_url)
        command.upgrade(config, "head")

        engine = make_engine(db_url)
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO courses (id, name, region, source, latitude, longitude) "
                "VALUES (1, 'Course', 'CA', 'seed', 37.7, -122.5)"
            ))
            conn.execute(text(
                "INSERT INTO course_images (course_id, storage_key, position, is_hero, source_type, moderation_status) "
                "VALUES (1, 'shared.jpg', 0, 1, 'official', 'approved'), "
                "(1, 'shared.jpg', 1, 0, 'official', 'approved')"
            ))
        engine.dispose()

        engine = make_engine(db_url)
        with pytest.raises(Exception):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO course_images (course_id, storage_key, position, is_hero, source_type, moderation_status) "
                    "VALUES (1, 'dup-user.jpg', 2, 0, 'user', 'pending'), "
                    "(1, 'dup-user.jpg', 3, 0, 'user', 'pending')"
                ))
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
