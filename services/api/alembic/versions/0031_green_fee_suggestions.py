"""add course_green_fee_suggestions for crowdsourced fee estimates

Revision ID: 0031_green_fee_suggestions
Revises: 0030_push_tokens
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_green_fee_suggestions"
down_revision = "0030_push_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_green_fee_suggestions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submitted_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("suggested_fee", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("course_id", "submitted_by_user_id", name="uq_green_fee_suggestion_course_user"),
    )
    op.create_index("ix_green_fee_suggestions_course_id", "course_green_fee_suggestions", ["course_id"])
    op.create_index(
        "ix_green_fee_suggestions_submitted_by_user_id", "course_green_fee_suggestions", ["submitted_by_user_id"]
    )
    op.create_index("ix_green_fee_suggestions_status", "course_green_fee_suggestions", ["status"])

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            ALTER TABLE course_green_fee_suggestions ENABLE ROW LEVEL SECURITY;
            REVOKE ALL PRIVILEGES ON TABLE course_green_fee_suggestions FROM PUBLIC;
            REVOKE ALL PRIVILEGES ON SEQUENCE course_green_fee_suggestions_id_seq FROM PUBLIC;
            DO $$
            DECLARE
                api_role text;
            BEGIN
                FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
                LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON TABLE course_green_fee_suggestions FROM %I',
                            api_role
                        );
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON SEQUENCE course_green_fee_suggestions_id_seq FROM %I',
                            api_role
                        );
                    END IF;
                END LOOP;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fairway_api') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE course_green_fee_suggestions
                        TO fairway_api;
                    GRANT USAGE, SELECT ON SEQUENCE course_green_fee_suggestions_id_seq
                        TO fairway_api;
                    CREATE POLICY course_green_fee_suggestions_fairway_api
                        ON course_green_fee_suggestions
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
    op.drop_index("ix_green_fee_suggestions_status", table_name="course_green_fee_suggestions")
    op.drop_index("ix_green_fee_suggestions_submitted_by_user_id", table_name="course_green_fee_suggestions")
    op.drop_index("ix_green_fee_suggestions_course_id", table_name="course_green_fee_suggestions")
    op.drop_table("course_green_fee_suggestions")
