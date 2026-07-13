"""persist the complete onboarding snapshot

Revision ID: 0002_onboarding_data
Revises: 0001_initial
Create Date: 2026-07-12
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_onboarding_data"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "onboarding_preferences",
        sa.Column("onboarding_data", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("onboarding_preferences", "onboarding_data")
