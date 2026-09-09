"""link user-uploaded course photos to the round they were submitted with

Revision ID: 0023_course_image_round_link
Revises: 0022_course_image_abstraction
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_course_image_round_link"
down_revision = "0022_course_image_abstraction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_images", sa.Column("round_id", sa.Integer(), nullable=True))
    op.create_index("ix_course_images_round_id", "course_images", ["round_id"])
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.create_foreign_key(
            "fk_course_images_round_id",
            "rounds",
            ["round_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("course_images") as batch_op:
        batch_op.drop_constraint("fk_course_images_round_id", type_="foreignkey")
    op.drop_index("ix_course_images_round_id", table_name="course_images")
    op.drop_column("course_images", "round_id")
