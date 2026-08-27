"""mark incomplete onboarding ranking seeds

Revision ID: 0019_incomplete_tier_assignments
Revises: 0018_unique_profile_usernames
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_incomplete_tier_assignments"
down_revision = "0018_unique_profile_usernames"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tier_assignments",
        sa.Column("is_incomplete", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_tier_assignments_is_incomplete", "tier_assignments", ["is_incomplete"])


def downgrade() -> None:
    op.drop_index("ix_tier_assignments_is_incomplete", table_name="tier_assignments")
    op.drop_column("tier_assignments", "is_incomplete")
