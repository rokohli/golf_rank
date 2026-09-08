"""cascade-delete user-uploaded course photos, dedupe on storage_key

Deleting a round or an account must remove its user-uploaded course photos
(rows here; the R2 objects are removed by application code in rounds.py's
delete_round and main.py's delete_account, which is why this migration only
needs to change ON DELETE behavior, not add any triggers). Previously both
FKs used SET NULL, which left the CourseImage row -- and therefore the
photo -- publicly reachable and ownerless/roundless after deletion.

Also adds a partial unique index on storage_key, scoped to USER-sourced rows,
so a replayed confirm_upload() call is idempotent instead of creating a
duplicate gallery entry / consuming another round-photo slot. OFFICIAL rows
are excluded from the index -- they may legitimately share one storage_key
(see migration 0024's Fleming/Harding shared hero image).

Revision ID: 0025_course_image_deletes
Revises: 0024_fix_course_photos
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_course_image_deletes"
down_revision = "0024_fix_course_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_constraint("fk_course_images_uploaded_by_user_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_course_images_uploaded_by_user_id",
            "users",
            ["uploaded_by_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.drop_constraint("fk_course_images_round_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_course_images_round_id",
            "rounds",
            ["round_id"],
            ["id"],
            ondelete="CASCADE",
        )
    op.create_index(
        "uq_course_image_user_storage_key",
        "course_images",
        ["storage_key"],
        unique=True,
        postgresql_where=sa.text("source_type = 'user'"),
    )


def downgrade() -> None:
    op.drop_index("uq_course_image_user_storage_key", table_name="course_images")
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_constraint("fk_course_images_round_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_course_images_round_id",
            "rounds",
            ["round_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.drop_constraint("fk_course_images_uploaded_by_user_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_course_images_uploaded_by_user_id",
            "users",
            ["uploaded_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
