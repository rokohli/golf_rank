"""add unique profile usernames

Revision ID: 0018_unique_profile_usernames
Revises: 0017_remove_profile_visibility
"""

import re

from alembic import op
import sqlalchemy as sa

# Mirrors app.schemas.USERNAME_PATTERN — legacy usernames that don't already fit
# this charset must be sanitized here, or they get copied in as-is and then fail
# every future save once the API starts validating against the same pattern.
_INVALID_USERNAME_CHARS = re.compile(r"[^a-z0-9_]")


revision = "0018_unique_profile_usernames"
down_revision = "0017_remove_profile_visibility"
branch_labels = None
depends_on = None


profiles = sa.table(
    "profiles",
    sa.column("user_id", sa.Integer()),
    sa.column("username", sa.String(length=64)),
)

preferences = sa.table(
    "onboarding_preferences",
    sa.column("user_id", sa.Integer()),
    sa.column("onboarding_data", sa.JSON()),
)


def upgrade() -> None:
    op.add_column("profiles", sa.Column("username", sa.String(length=64), nullable=True))
    connection = op.get_bind()
    claimed: set[str] = set()
    rows = connection.execute(
        sa.select(preferences.c.user_id, preferences.c.onboarding_data).where(
            preferences.c.onboarding_data.is_not(None)
        )
    )
    for user_id, onboarding_data in rows:
        if not isinstance(onboarding_data, dict):
            continue
        raw = onboarding_data.get("username")
        if not isinstance(raw, str):
            continue
        normalized = _INVALID_USERNAME_CHARS.sub("", raw.strip().lstrip("@").lower())
        if len(normalized) < 2:
            normalized = f"golfer_{user_id}"
        normalized = normalized[:64]
        candidate = normalized
        suffix = 0
        while candidate in claimed:
            suffix += 1
            candidate = f"{normalized[:50]}_{user_id}" if suffix == 1 else f"{normalized[:40]}_{user_id}_{suffix}"
        claimed.add(candidate)
        connection.execute(
            sa.update(profiles).where(profiles.c.user_id == user_id).values(username=candidate)
        )
        if candidate != raw:
            # Keep onboarding_data in sync with the sanitized username — schemas.py
            # validates onboarding_data.username against the same pattern on read,
            # so leaving the original raw value here would fail every future load.
            updated = dict(onboarding_data)
            updated["username"] = candidate
            connection.execute(
                sa.update(preferences)
                .where(preferences.c.user_id == user_id)
                .values(onboarding_data=updated)
            )
    op.create_index("uq_profiles_username", "profiles", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_profiles_username", table_name="profiles")
    op.drop_column("profiles", "username")
