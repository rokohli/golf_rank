"""add comparison-based personal rankings

Revision ID: 0003_comparison_rankings
Revises: 0002_onboarding_data
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_comparison_rankings"
down_revision = "0002_onboarding_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tier_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("tier", sa.String(length=20), nullable=False),
        sa.Column("ordinal_position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "course_id", name="uq_tier_assignment_user_course"),
    )
    op.create_index("ix_tier_assignments_user_id", "tier_assignments", ["user_id"])
    op.create_index("ix_tier_assignments_course_id", "tier_assignments", ["course_id"])
    op.create_index("ix_tier_assignments_tier", "tier_assignments", ["tier"])

    op.create_table(
        "comparisons",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_a_id", sa.Integer(), nullable=False),
        sa.Column("course_b_id", sa.Integer(), nullable=False),
        sa.Column("preferred_course_id", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_a_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_b_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["preferred_course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_comparisons_user_id", "comparisons", ["user_id"])
    op.create_index("ix_comparisons_outcome", "comparisons", ["outcome"])

    op.create_table(
        "ranking_confidences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("decisive_comparisons", sa.Integer(), nullable=False),
        sa.Column("uncertain_comparisons", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "course_id", name="uq_ranking_confidence_user_course"),
    )
    op.create_index("ix_ranking_confidences_user_id", "ranking_confidences", ["user_id"])
    op.create_index("ix_ranking_confidences_course_id", "ranking_confidences", ["course_id"])

    op.create_table(
        "ranking_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=40), nullable=False),
        sa.Column("overall_confidence", sa.Float(), nullable=False),
        sa.Column("ranking_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "version", name="uq_ranking_snapshot_user_version"),
    )
    op.create_index("ix_ranking_snapshots_user_id", "ranking_snapshots", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ranking_snapshots_user_id", table_name="ranking_snapshots")
    op.drop_table("ranking_snapshots")
    op.drop_index("ix_ranking_confidences_course_id", table_name="ranking_confidences")
    op.drop_index("ix_ranking_confidences_user_id", table_name="ranking_confidences")
    op.drop_table("ranking_confidences")
    op.drop_index("ix_comparisons_outcome", table_name="comparisons")
    op.drop_index("ix_comparisons_user_id", table_name="comparisons")
    op.drop_table("comparisons")
    op.drop_index("ix_tier_assignments_tier", table_name="tier_assignments")
    op.drop_index("ix_tier_assignments_course_id", table_name="tier_assignments")
    op.drop_index("ix_tier_assignments_user_id", table_name="tier_assignments")
    op.drop_table("tier_assignments")
