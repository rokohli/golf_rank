"""add scoring_claimed_at and moderation_action to course_images

Adds scoring_claimed_at for atomic scoring claim leases (preventing background
and sweeper overlap without holding row locks across outbound HTTP calls) and
moderation_action to explicitly distinguish approve, reject, feature, and
unfeature actions in audit trails.

ORDERING NOTE -- see 0027's note about uq_course_image_user_storage_key and
SQLite batch_alter_table.
"""

from alembic import op
import sqlalchemy as sa


revision = "0028_moderation_concurrency"
down_revision = "0027_course_image_moderation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "course_images",
        sa.Column("scoring_claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "course_images",
        sa.Column("moderation_action", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_index("uq_course_image_user_storage_key", table_name="course_images")

    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_column("moderation_action")
        batch_op.drop_column("scoring_claimed_at")

    op.create_index(
        "uq_course_image_user_storage_key",
        "course_images",
        ["storage_key"],
        unique=True,
        postgresql_where=sa.text("source_type = 'user'"),
        sqlite_where=sa.text("source_type = 'user'"),
    )
