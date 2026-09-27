"""add golfer_reports column to plan_candidates table

Revision ID: 0034_plan_candidate_golfer_reports
Revises: 0033_round_tags
"""

import sqlalchemy as sa
from alembic import op


revision = "0034_plan_candidate_golfer_reports"
down_revision = "0033_round_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("plan_candidates") as batch_op:
        batch_op.add_column(
            sa.Column("golfer_reports", sa.JSON(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("plan_candidates") as batch_op:
        batch_op.drop_column("golfer_reports")
