"""course image priority abstraction: source/moderation metadata and Wikimedia negative cache

Revision ID: 0022_course_image_abstraction
Revises: 0021_deleted_identities
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_course_image_abstraction"
down_revision = "0021_deleted_identities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_images", sa.Column("thumbnail_url", sa.String(length=2048), nullable=True))
    op.add_column(
        "course_images",
        sa.Column("source_type", sa.String(length=20), nullable=False, server_default="wikimedia"),
    )
    op.add_column(
        "course_images",
        sa.Column("moderation_status", sa.String(length=20), nullable=False, server_default="approved"),
    )
    op.add_column("course_images", sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True))
    op.add_column("course_images", sa.Column("quality_score", sa.Float(), nullable=True))
    op.add_column("course_images", sa.Column("width", sa.Integer(), nullable=True))
    op.add_column("course_images", sa.Column("height", sa.Integer(), nullable=True))
    # SQLite refuses ADD COLUMN with a non-constant (CURRENT_TIMESTAMP) default
    # once the table already has rows -- batch mode rebuilds the table instead,
    # which works on both SQLite and Postgres.
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.add_column(
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        batch_op.add_column(
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    # Pre-existing rows predate the OFFICIAL/USER/WIKIMEDIA split. A storage_key
    # row is a GolfRank-managed curated photo, not a Wikimedia cache entry --
    # label it OFFICIAL so the resolver never refreshes/deletes it as stale
    # Wikimedia data (which would also violate ck_course_image_one_locator by
    # setting external_url without clearing storage_key). Pre-existing
    # external_url rows keep the "wikimedia" default, which matches how they
    # were actually sourced before this migration.
    course_images = sa.table(
        "course_images",
        sa.column("storage_key", sa.String),
        sa.column("source_type", sa.String),
    )
    op.execute(
        course_images.update()
        .where(course_images.c.storage_key.isnot(None))
        .values(source_type="official")
    )

    op.create_index("ix_course_images_source_type", "course_images", ["source_type"])
    op.create_index("ix_course_images_moderation_status", "course_images", ["moderation_status"])
    op.create_index("ix_course_images_uploaded_by_user_id", "course_images", ["uploaded_by_user_id"])
    # SQLite can't ALTER a constraint onto an existing table -- batch mode
    # rebuilds it via copy-and-move, which works on both SQLite and Postgres.
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.create_foreign_key(
            "fk_course_images_uploaded_by_user_id",
            "users",
            ["uploaded_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_table(
        "course_image_negative_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("course_id", "provider", name="uq_course_image_negative_cache"),
    )
    op.create_index("ix_course_image_negative_cache_course_id", "course_image_negative_cache", ["course_id"])
    op.create_index("ix_course_image_negative_cache_provider", "course_image_negative_cache", ["provider"])
    op.create_index("ix_course_image_negative_cache_expires_at", "course_image_negative_cache", ["expires_at"])


def downgrade() -> None:
    op.drop_table("course_image_negative_cache")
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_constraint("fk_course_images_uploaded_by_user_id", type_="foreignkey")
    op.drop_index("ix_course_images_uploaded_by_user_id", table_name="course_images")
    op.drop_index("ix_course_images_moderation_status", table_name="course_images")
    op.drop_index("ix_course_images_source_type", table_name="course_images")
    op.drop_column("course_images", "updated_at")
    op.drop_column("course_images", "created_at")
    op.drop_column("course_images", "height")
    op.drop_column("course_images", "width")
    op.drop_column("course_images", "quality_score")
    op.drop_column("course_images", "uploaded_by_user_id")
    op.drop_column("course_images", "moderation_status")
    op.drop_column("course_images", "source_type")
    op.drop_column("course_images", "thumbnail_url")
