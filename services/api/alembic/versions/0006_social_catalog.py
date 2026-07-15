"""add social interactions and canonical course catalog

Revision ID: 0006_social_catalog
Revises: 0005_rating_experience
Create Date: 2026-07-15
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_social_catalog"
down_revision = "0005_rating_experience"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("courses") as batch_op:
        batch_op.alter_column("green_fee", existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column("difficulty", existing_type=sa.String(length=20), nullable=True)
        batch_op.alter_column("is_public", existing_type=sa.Boolean(), nullable=True)
        batch_op.add_column(sa.Column("source", sa.String(length=40), server_default="seed", nullable=False))
        batch_op.add_column(sa.Column("source_course_id", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("google_place_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("country_code", sa.String(length=2), server_default="US", nullable=False))
        batch_op.add_column(sa.Column("admin1_code", sa.String(length=12), nullable=True))
        batch_op.add_column(sa.Column("admin1_name", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("city", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("facility_name", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("course_name", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("status", sa.String(length=20), server_default="active", nullable=False))
        batch_op.add_column(sa.Column("hole_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("access", sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_unique_constraint("uq_course_source_identity", ["source", "source_course_id"])
        batch_op.create_unique_constraint("uq_courses_google_place_id", ["google_place_id"])
    for column in ("source", "country_code", "admin1_code", "city", "status", "access"):
        op.create_index(f"ix_courses_{column}", "courses", [column])

    op.create_table(
        "course_reconciliations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("source_course_id", sa.String(length=120), nullable=False),
        sa.Column("canonical_course_id", sa.Integer(), nullable=False),
        sa.Column("match_status", sa.String(length=20), server_default="confirmed", nullable=False),
        sa.Column("match_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["canonical_course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("source_course_id", "canonical_course_id", name="uq_course_reconciliation"),
    )
    op.create_index("ix_course_reconciliations_source", "course_reconciliations", ["source"])
    op.create_index("ix_course_reconciliations_source_course_id", "course_reconciliations", ["source_course_id"])
    op.create_index("ix_course_reconciliations_canonical_course_id", "course_reconciliations", ["canonical_course_id"])

    op.create_table(
        "activity_reactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("reaction", sa.String(length=20), server_default="like", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["activity_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("event_id", "user_id", "reaction", name="uq_activity_reaction"),
    )
    op.create_index("ix_activity_reactions_event_id", "activity_reactions", ["event_id"])
    op.create_index("ix_activity_reactions_user_id", "activity_reactions", ["user_id"])

    for table, owner, target, constraint in (
        ("user_blocks", "blocker_id", "blocked_id", "uq_user_block"),
        ("user_mutes", "muter_id", "muted_id", "uq_user_mute"),
    ):
        op.create_table(
            table,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(owner, sa.Integer(), nullable=False),
            sa.Column(target, sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint([owner], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint([target], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(owner, target, name=constraint),
        )
        op.create_index(f"ix_{table}_{owner}", table, [owner])
        op.create_index(f"ix_{table}_{target}", table, [target])

    op.create_table(
        "course_candidates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submitted_by_user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("admin1_code", sa.String(length=12), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["submitted_by_user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_course_candidates_submitted_by_user_id", "course_candidates", ["submitted_by_user_id"])
    op.create_index("ix_course_candidates_status", "course_candidates", ["status"])


def downgrade() -> None:
    op.drop_index("ix_course_candidates_status", table_name="course_candidates")
    op.drop_index("ix_course_candidates_submitted_by_user_id", table_name="course_candidates")
    op.drop_table("course_candidates")
    for table, owner, target in (
        ("user_mutes", "muter_id", "muted_id"),
        ("user_blocks", "blocker_id", "blocked_id"),
    ):
        op.drop_index(f"ix_{table}_{target}", table_name=table)
        op.drop_index(f"ix_{table}_{owner}", table_name=table)
        op.drop_table(table)
    op.drop_index("ix_activity_reactions_user_id", table_name="activity_reactions")
    op.drop_index("ix_activity_reactions_event_id", table_name="activity_reactions")
    op.drop_table("activity_reactions")
    op.drop_index("ix_course_reconciliations_canonical_course_id", table_name="course_reconciliations")
    op.drop_index("ix_course_reconciliations_source_course_id", table_name="course_reconciliations")
    op.drop_index("ix_course_reconciliations_source", table_name="course_reconciliations")
    op.drop_table("course_reconciliations")
    for column in ("access", "status", "city", "admin1_code", "country_code", "source"):
        op.drop_index(f"ix_courses_{column}", table_name="courses")
    with op.batch_alter_table("courses") as batch_op:
        batch_op.drop_constraint("uq_courses_google_place_id", type_="unique")
        batch_op.drop_constraint("uq_course_source_identity", type_="unique")
        for column in (
            "last_verified_at", "source_updated_at", "access", "hole_count", "status",
            "course_name", "facility_name", "city", "admin1_name", "admin1_code",
            "country_code", "google_place_id", "source_course_id", "source",
        ):
            batch_op.drop_column(column)
        batch_op.alter_column("green_fee", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("difficulty", existing_type=sa.String(length=20), nullable=False)
        batch_op.alter_column("is_public", existing_type=sa.Boolean(), nullable=False)
