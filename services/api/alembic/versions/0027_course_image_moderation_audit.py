"""record who moderated a course photo, and what the scorer said about it

Adds the audit trail the admin moderation surface needs (who acted, when, and
why) plus the bookkeeping the Gemini quality scorer needs to be idempotent and
bounded (scored_at, scoring_attempts, and the scorer's stated reasons).

moderated_by_user_id uses ON DELETE SET NULL rather than the CASCADE that
uploaded_by_user_id carries: a user's own upload is their content and should go
with their account, but deleting a moderator's account must not delete every
photo they ever approved.

ORDERING NOTE -- the statements below are ordered the way they are on purpose.
uq_course_image_user_storage_key is a *partial* unique index (WHERE source_type
= 'user'). Adding a foreign key requires batch_alter_table, which on SQLite
recreates the whole table; doing that while the partial index exists risks
Alembic's batch reflection re-emitting it without its WHERE predicate, silently
turning it into a global unique constraint on storage_key and breaking
migration 0024's Fleming/Harding OFFICIAL rows, which deliberately share one
storage_key. Migration 0025 avoids this by creating that index as its very last
statement; this migration drops it first and recreates it last for the same
reason. tests/test_migration_lifecycle.py asserts the predicate survives.

Revision ID: 0027_course_image_moderation
Revises: 0026_failed_object_deletions
"""

from alembic import op
import sqlalchemy as sa


# Shortened from the filename stem on purpose: alembic_version.version_num is
# varchar(32), and "0027_course_image_moderation_audit" is 34 characters --
# Postgres rejects it with StringDataRightTruncation while SQLite silently
# accepts it. Several earlier migrations (0011, 0012, 0016, 0021) are shortened
# for the same reason, so always read this constant rather than assuming the id
# matches the filename.
revision = "0027_course_image_moderation"
down_revision = "0026_failed_object_deletions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("uq_course_image_user_storage_key", table_name="course_images")

    op.add_column("course_images", sa.Column("quality_score_reasons", sa.JSON(), nullable=True))
    op.add_column("course_images", sa.Column("scored_at", sa.DateTime(timezone=True), nullable=True))
    # server_default is required, not cosmetic: SQLite rejects ADD COLUMN NOT
    # NULL without one. Every other column added here is nullable.
    op.add_column(
        "course_images",
        sa.Column("scoring_attempts", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("course_images", sa.Column("moderated_by_user_id", sa.Integer(), nullable=True))
    op.add_column("course_images", sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("course_images", sa.Column("moderation_reason", sa.String(length=200), nullable=True))

    op.create_index(
        "ix_course_images_moderated_by_user_id", "course_images", ["moderated_by_user_id"]
    )
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.create_foreign_key(
            "fk_course_images_moderated_by_user_id",
            "users",
            ["moderated_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index(
        "uq_course_image_user_storage_key",
        "course_images",
        ["storage_key"],
        unique=True,
        postgresql_where=sa.text("source_type = 'user'"),
        sqlite_where=sa.text("source_type = 'user'"),
    )


def downgrade() -> None:
    op.drop_index("uq_course_image_user_storage_key", table_name="course_images")

    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_constraint("fk_course_images_moderated_by_user_id", type_="foreignkey")
    op.drop_index("ix_course_images_moderated_by_user_id", table_name="course_images")

    # Inside a batch block: SQLite before 3.35 cannot DROP COLUMN at all, and
    # 0021's downgrade already proves this shape works on both backends.
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_column("moderation_reason")
        batch_op.drop_column("moderated_at")
        batch_op.drop_column("moderated_by_user_id")
        batch_op.drop_column("scoring_attempts")
        batch_op.drop_column("scored_at")
        batch_op.drop_column("quality_score_reasons")

    op.create_index(
        "uq_course_image_user_storage_key",
        "course_images",
        ["storage_key"],
        unique=True,
        postgresql_where=sa.text("source_type = 'user'"),
        sqlite_where=sa.text("source_type = 'user'"),
    )
