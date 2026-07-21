"""add enriched course facts and image metadata

Revision ID: 0010_course_detail_enrichment
Revises: 0009_clean_course_names
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op


revision = "0010_course_detail_enrichment"
down_revision = "0009_clean_course_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("courses") as batch_op:
        batch_op.add_column(sa.Column("par", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("slope_rating", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("tee_time_url", sa.String(length=2048), nullable=True))

    op.create_table(
        "course_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=True),
        sa.Column("external_url", sa.String(length=2048), nullable=True),
        sa.Column("alt_text", sa.String(length=255), nullable=True),
        sa.Column("source_name", sa.String(length=120), nullable=True),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_hero", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "(storage_key IS NOT NULL AND external_url IS NULL) OR "
            "(storage_key IS NULL AND external_url IS NOT NULL)",
            name="ck_course_image_one_locator",
        ),
        sa.UniqueConstraint("course_id", "position", name="uq_course_image_position"),
    )
    op.create_index("ix_course_images_course_id", "course_images", ["course_id"])

    courses = sa.table(
        "courses",
        sa.column("source", sa.String()),
        sa.column("source_course_id", sa.String()),
        sa.column("hole_count", sa.Integer()),
        sa.column("par", sa.Integer()),
        sa.column("slope_rating", sa.Integer()),
        sa.column("tee_time_url", sa.String()),
    )
    verified_seed_data = {
        "pebble": (18, 72, 145, "https://www.pebblebeach.com/plan-my-trip/preview-availability/"),
        "spyglass": (18, 72, 145, "https://www.pebblebeach.com/plan-my-trip/preview-availability/"),
        "pasatiempo": (18, 70, 141, "https://www.pasatiempo.com/golf/rates"),
    }
    connection = op.get_bind()
    for source_course_id, (holes, par, slope, tee_time_url) in verified_seed_data.items():
        connection.execute(
            courses.update()
            .where(courses.c.source == "seed", courses.c.source_course_id == source_course_id)
            .values(
                hole_count=holes,
                par=par,
                slope_rating=slope,
                tee_time_url=tee_time_url,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_course_images_course_id", table_name="course_images")
    op.drop_table("course_images")
    with op.batch_alter_table("courses") as batch_op:
        batch_op.drop_column("tee_time_url")
        batch_op.drop_column("slope_rating")
        batch_op.drop_column("par")
