"""persist guarded AI planner generation metadata

Revision ID: 0015_ai_plan_generations
Revises: 0014_provider_first_catalog
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_ai_plan_generations"
down_revision = "0014_provider_first_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_generations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "plan_id",
            sa.Integer(),
            sa.ForeignKey("plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("model_identifier", sa.String(length=120), nullable=True),
        sa.Column("prompt_version", sa.String(length=40), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_micros", sa.Integer(), nullable=True),
        sa.Column("fallback_reason", sa.String(length=80), nullable=True),
        sa.Column("generated_summary", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_plan_generations_plan_id", "plan_generations", ["plan_id"]
    )
    op.create_index(
        "ix_plan_generations_status", "plan_generations", ["status"]
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            ALTER TABLE plan_generations ENABLE ROW LEVEL SECURITY;
            REVOKE ALL PRIVILEGES ON TABLE plan_generations FROM PUBLIC;
            REVOKE ALL PRIVILEGES ON SEQUENCE plan_generations_id_seq FROM PUBLIC;
            DO $$
            DECLARE
                api_role text;
            BEGIN
                FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
                LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON TABLE plan_generations FROM %I',
                            api_role
                        );
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON SEQUENCE plan_generations_id_seq FROM %I',
                            api_role
                        );
                    END IF;
                END LOOP;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fairway_api') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plan_generations
                        TO fairway_api;
                    GRANT USAGE, SELECT ON SEQUENCE plan_generations_id_seq
                        TO fairway_api;
                    CREATE POLICY plan_generations_fairway_api
                        ON plan_generations
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
    op.drop_index("ix_plan_generations_status", table_name="plan_generations")
    op.drop_index("ix_plan_generations_plan_id", table_name="plan_generations")
    op.drop_table("plan_generations")
