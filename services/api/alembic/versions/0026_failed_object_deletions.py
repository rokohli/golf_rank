"""track failed permanent R2 object deletions for retry

Revision ID: 0026_failed_object_deletions
Revises: 0025_course_image_deletes
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_failed_object_deletions"
down_revision = "0025_course_image_deletes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "failed_object_deletions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("context", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_failed_object_deletions_storage_key", "failed_object_deletions", ["storage_key"],
    )


def downgrade() -> None:
    op.drop_index("ix_failed_object_deletions_storage_key", table_name="failed_object_deletions")
    op.drop_table("failed_object_deletions")
