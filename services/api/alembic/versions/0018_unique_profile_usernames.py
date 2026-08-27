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
    # Order deterministically, and give already-valid usernames priority over ones
    # that need sanitizing — otherwise which row happens to be read first decides
    # who keeps a contested name, and a dirty username (e.g. "golf-er") could claim
    # a clean one's exact handle (e.g. "golfer") before the clean row is even seen.
    rows = list(connection.execute(
        sa.select(preferences.c.user_id, preferences.c.onboarding_data)
        .where(preferences.c.onboarding_data.is_not(None))
        .order_by(preferences.c.user_id)
    ))

    candidates: list[tuple[int, dict, str, bool]] = []
    for user_id, onboarding_data in rows:
        if not isinstance(onboarding_data, dict):
            continue
        raw = onboarding_data.get("username")
        if not isinstance(raw, str):
            continue
        stripped_lower = raw.strip().lstrip("@").lower()
        sanitized = _INVALID_USERNAME_CHARS.sub("", stripped_lower)
        is_clean = sanitized == stripped_lower and len(sanitized) >= 2
        if len(sanitized) < 2:
            sanitized = f"golfer_{user_id}"
        candidates.append((user_id, onboarding_data, sanitized[:64], is_clean))

    claimed: set[str] = set()
    ordered_candidates = [c for c in candidates if c[3]] + [c for c in candidates if not c[3]]
    for user_id, onboarding_data, normalized, _is_clean in ordered_candidates:
        candidate = normalized
        suffix = 0
        while candidate in claimed:
            suffix += 1
            candidate = f"{normalized[:50]}_{user_id}" if suffix == 1 else f"{normalized[:40]}_{user_id}_{suffix}"
        claimed.add(candidate)
        connection.execute(
            sa.update(profiles).where(profiles.c.user_id == user_id).values(username=candidate)
        )
        if candidate != onboarding_data.get("username"):
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
