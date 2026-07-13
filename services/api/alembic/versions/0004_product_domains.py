"""add rounds social saves and planning domains

Revision ID: 0004_product_domains
Revises: 0003_comparison_rankings
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_product_domains"
down_revision = "0003_comparison_rankings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rounds",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("played_on", sa.Date(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("visibility", sa.String(length=20), server_default="friends", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rounds_user_id", "rounds", ["user_id"])
    op.create_index("ix_rounds_course_id", "rounds", ["course_id"])
    op.create_index("ix_rounds_played_on", "rounds", ["played_on"])
    op.create_index("ix_rounds_visibility", "rounds", ["visibility"])

    op.create_table(
        "follows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("follower_id", sa.Integer(), nullable=False),
        sa.Column("followed_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["followed_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("follower_id", "followed_id", name="uq_follow_follower_followed"),
    )
    op.create_index("ix_follows_follower_id", "follows", ["follower_id"])
    op.create_index("ix_follows_followed_id", "follows", ["followed_id"])

    op.create_table(
        "saved_lists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("visibility", sa.String(length=20), server_default="private", nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_saved_list_user_name"),
    )
    op.create_index("ix_saved_lists_user_id", "saved_lists", ["user_id"])

    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_plans_user_id", "plans", ["user_id"])
    op.create_index("ix_plans_status", "plans", ["status"])

    op.create_table(
        "round_notes",
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["round_id"], ["rounds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("round_id"),
    )
    op.create_table(
        "user_course_states",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("has_played", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("round_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_played_on", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "course_id", name="uq_user_course_state_user_course"),
    )
    op.create_index("ix_user_course_states_user_id", "user_course_states", ["user_id"])
    op.create_index("ix_user_course_states_course_id", "user_course_states", ["course_id"])

    op.create_table(
        "activity_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("subject_type", sa.String(length=40), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("visibility", sa.String(length=20), server_default="friends", nullable=False),
        sa.Column("event_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_activity_events_actor_user_id", "activity_events", ["actor_user_id"])
    op.create_index("ix_activity_events_event_type", "activity_events", ["event_type"])
    op.create_index("ix_activity_events_visibility", "activity_events", ["visibility"])
    op.create_index("ix_activity_events_created_at", "activity_events", ["created_at"])

    op.create_table(
        "saved_courses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("list_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["list_id"], ["saved_lists.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("list_id", "course_id", name="uq_saved_course_list_course"),
    )
    op.create_index("ix_saved_courses_list_id", "saved_courses", ["list_id"])
    op.create_index("ix_saved_courses_course_id", "saved_courses", ["course_id"])

    op.create_table(
        "plan_constraints",
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("constraint_data", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("plan_id"),
    )
    op.create_table(
        "plan_candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("distance_miles", sa.Float(), nullable=True),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.Column("caveats", sa.JSON(), nullable=False),
        sa.Column("source_checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plan_id", "course_id", name="uq_plan_candidate_plan_course"),
    )
    op.create_index("ix_plan_candidates_plan_id", "plan_candidates", ["plan_id"])
    op.create_index("ix_plan_candidates_course_id", "plan_candidates", ["course_id"])

    op.create_table(
        "itinerary_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=True),
        sa.Column("item_date", sa.Date(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("start_time", sa.String(length=20), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_itinerary_items_plan_id", "itinerary_items", ["plan_id"])


def downgrade() -> None:
    op.drop_index("ix_itinerary_items_plan_id", table_name="itinerary_items")
    op.drop_table("itinerary_items")
    op.drop_index("ix_plan_candidates_course_id", table_name="plan_candidates")
    op.drop_index("ix_plan_candidates_plan_id", table_name="plan_candidates")
    op.drop_table("plan_candidates")
    op.drop_table("plan_constraints")
    op.drop_index("ix_saved_courses_course_id", table_name="saved_courses")
    op.drop_index("ix_saved_courses_list_id", table_name="saved_courses")
    op.drop_table("saved_courses")
    op.drop_index("ix_activity_events_created_at", table_name="activity_events")
    op.drop_index("ix_activity_events_visibility", table_name="activity_events")
    op.drop_index("ix_activity_events_event_type", table_name="activity_events")
    op.drop_index("ix_activity_events_actor_user_id", table_name="activity_events")
    op.drop_table("activity_events")
    op.drop_index("ix_user_course_states_course_id", table_name="user_course_states")
    op.drop_index("ix_user_course_states_user_id", table_name="user_course_states")
    op.drop_table("user_course_states")
    op.drop_table("round_notes")
    op.drop_index("ix_plans_status", table_name="plans")
    op.drop_index("ix_plans_user_id", table_name="plans")
    op.drop_table("plans")
    op.drop_index("ix_saved_lists_user_id", table_name="saved_lists")
    op.drop_table("saved_lists")
    op.drop_index("ix_follows_followed_id", table_name="follows")
    op.drop_index("ix_follows_follower_id", table_name="follows")
    op.drop_table("follows")
    op.drop_index("ix_rounds_visibility", table_name="rounds")
    op.drop_index("ix_rounds_played_on", table_name="rounds")
    op.drop_index("ix_rounds_course_id", table_name="rounds")
    op.drop_index("ix_rounds_user_id", table_name="rounds")
    op.drop_table("rounds")
