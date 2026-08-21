"""remove the retired profile visibility preference

Revision ID: 0017_remove_profile_visibility
Revises: 0016_notifications_contacts
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_remove_profile_visibility"
down_revision = "0016_notifications_contacts"
branch_labels = None
depends_on = None


preferences = sa.table(
    "onboarding_preferences",
    sa.column("user_id", sa.Integer()),
    sa.column("onboarding_data", sa.JSON()),
)


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(preferences.c.user_id, preferences.c.onboarding_data).where(
            preferences.c.onboarding_data.is_not(None)
        )
    )
    for user_id, onboarding_data in rows:
        if not isinstance(onboarding_data, dict) or "profile_visibility" not in onboarding_data:
            continue
        normalized = dict(onboarding_data)
        normalized.pop("profile_visibility", None)
        connection.execute(
            sa.update(preferences)
            .where(preferences.c.user_id == user_id)
            .values(onboarding_data=normalized)
        )


def downgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(preferences.c.user_id, preferences.c.onboarding_data).where(
            preferences.c.onboarding_data.is_not(None)
        )
    )
    for user_id, onboarding_data in rows:
        if not isinstance(onboarding_data, dict) or "profile_visibility" in onboarding_data:
            continue
        restored = dict(onboarding_data)
        restored["profile_visibility"] = "public"
        connection.execute(
            sa.update(preferences)
            .where(preferences.c.user_id == user_id)
            .values(onboarding_data=restored)
        )
