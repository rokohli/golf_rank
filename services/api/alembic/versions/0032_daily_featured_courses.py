"""add daily_featured_courses table for personalized course recommendations

Revision ID: 0032_daily_featured_courses
Revises: 0031_green_fee_suggestions
"""

from alembic import op
import sqlalchemy as sa


revision = "0032_daily_featured_courses"
down_revision = "0031_green_fee_suggestions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daily_featured_courses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recommendation_date", sa.Date(), nullable=False),
        sa.Column("sequence", sa.Integer(), server_default="1", nullable=False),
        sa.Column("dismissed", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("headline", sa.String(length=120), nullable=False),
        sa.Column("rationale", sa.String(length=500), nullable=False),
        sa.Column("match_tags", sa.JSON(), nullable=False),
        sa.Column("is_regional_fallback", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("generation_status", sa.String(length=20), server_default="fallback_template", nullable=False),
        sa.Column("estimated_cost_micros", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        # Dual uniqueness constraints serve complementary invariants:
        # 1. uq_daily_featured_user_date_seq ensures sequence numbers (1, 2, 3, 4) cannot be
        #    duplicated for a user on a given date during refresh attempts.
        sa.UniqueConstraint("user_id", "recommendation_date", "sequence", name="uq_daily_featured_user_date_seq"),
    )
    op.create_index("ix_daily_featured_courses_user_id", "daily_featured_courses", ["user_id"])
    op.create_index("ix_daily_featured_courses_course_id", "daily_featured_courses", ["course_id"])
    op.create_index("ix_daily_featured_courses_recommendation_date", "daily_featured_courses", ["recommendation_date"])

    # 2. uq_daily_featured_active_user_date (Partial unique index) ensures that AT MOST ONE
    #    recommendation can be active (non-dismissed) per user on any given date.
    op.create_index(
        "uq_daily_featured_active_user_date",
        "daily_featured_courses",
        ["user_id", "recommendation_date"],
        unique=True,
        postgresql_where=sa.text("dismissed = false"),
        sqlite_where=sa.text("dismissed = 0"),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            ALTER TABLE daily_featured_courses ENABLE ROW LEVEL SECURITY;
            REVOKE ALL PRIVILEGES ON TABLE daily_featured_courses FROM PUBLIC;
            REVOKE ALL PRIVILEGES ON SEQUENCE daily_featured_courses_id_seq FROM PUBLIC;
            DO $$
            DECLARE
                api_role text;
            BEGIN
                FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
                LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON TABLE daily_featured_courses FROM %I',
                            api_role
                        );
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON SEQUENCE daily_featured_courses_id_seq FROM %I',
                            api_role
                        );
                    END IF;
                END LOOP;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fairway_api') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE daily_featured_courses
                        TO fairway_api;
                    GRANT USAGE, SELECT ON SEQUENCE daily_featured_courses_id_seq
                        TO fairway_api;
                    CREATE POLICY daily_featured_courses_fairway_api
                        ON daily_featured_courses
                        FOR ALL
                        TO fairway_api
                        USING (true)
                        WITH CHECK (true);
                END IF;
            END
            $$;
            """
        )


def downgrade() -> None:
    op.drop_index("uq_daily_featured_active_user_date", table_name="daily_featured_courses")
    op.drop_index("ix_daily_featured_courses_recommendation_date", table_name="daily_featured_courses")
    op.drop_index("ix_daily_featured_courses_course_id", table_name="daily_featured_courses")
    op.drop_index("ix_daily_featured_courses_user_id", table_name="daily_featured_courses")
    op.drop_table("daily_featured_courses")
