"""add golfer_reports column to plan_candidates and daily_featured_courses

Revision ID: 0034_grounded_snapshots
Revises: 0033_round_tags
"""

import sqlalchemy as sa
from alembic import op


revision = "0034_grounded_snapshots"
down_revision = "0033_round_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("plan_candidates") as batch_op:
        batch_op.add_column(
            sa.Column("golfer_reports", sa.JSON(), nullable=True)
        )
    with op.batch_alter_table("daily_featured_courses") as batch_op:
        batch_op.add_column(
            sa.Column("golfer_reports", sa.JSON(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("daily_featured_courses") as batch_op:
        batch_op.drop_column("golfer_reports")
    with op.batch_alter_table("plan_candidates") as batch_op:
        batch_op.drop_column("golfer_reports")
