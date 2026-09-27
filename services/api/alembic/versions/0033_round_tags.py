"""add tags to rounds table

Revision ID: 0033_round_tags
Revises: 0032_daily_featured_courses
"""

import sqlalchemy as sa
from alembic import op


revision = "0033_round_tags"
down_revision = "0032_daily_featured_courses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rounds") as batch_op:
        batch_op.add_column(
            sa.Column("tags", sa.JSON(), server_default="[]", nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("rounds") as batch_op:
        batch_op.drop_column("tags")
