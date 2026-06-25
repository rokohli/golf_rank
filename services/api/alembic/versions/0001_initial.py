"""initial foundation schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-25
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_subject"),
    )
    op.create_index("ix_users_provider_subject", "users", ["provider_subject"], unique=False)

    op.create_table(
        "courses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("region", sa.String(length=120), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("difficulty", sa.String(length=20), nullable=False),
        sa.Column("green_fee", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_courses_name", "courses", ["name"], unique=False)
    op.create_index("ix_courses_region", "courses", ["region"], unique=False)
    op.create_index("ix_courses_is_public", "courses", ["is_public"], unique=False)
    op.create_index("ix_courses_difficulty", "courses", ["difficulty"], unique=False)
    op.create_index("ix_courses_green_fee", "courses", ["green_fee"], unique=False)

    op.create_table(
        "profiles",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("home_region", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "onboarding_preferences",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("max_green_fee", sa.Integer(), nullable=False),
        sa.Column("difficulty", sa.String(length=20), nullable=False),
        sa.Column("access", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("onboarding_preferences")
    op.drop_table("profiles")
    op.drop_index("ix_courses_green_fee", table_name="courses")
    op.drop_index("ix_courses_difficulty", table_name="courses")
    op.drop_index("ix_courses_is_public", table_name="courses")
    op.drop_index("ix_courses_region", table_name="courses")
    op.drop_index("ix_courses_name", table_name="courses")
    op.drop_table("courses")
    op.drop_index("ix_users_provider_subject", table_name="users")
    op.drop_table("users")
