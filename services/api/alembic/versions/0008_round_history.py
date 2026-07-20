"""add round history favorites

Revision ID: 0008_round_history
Revises: 0007_reconciliation_source_scope
Create Date: 2026-07-17
"""

import sqlalchemy as sa
from alembic import op


revision = "0008_round_history"
down_revision = "0007_reconciliation_source_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rounds") as batch_op:
        batch_op.add_column(
            sa.Column("is_favorite", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch_op.create_index("ix_rounds_is_favorite", ["is_favorite"])


def downgrade() -> None:
    with op.batch_alter_table("rounds") as batch_op:
        batch_op.drop_index("ix_rounds_is_favorite")
        batch_op.drop_column("is_favorite")
