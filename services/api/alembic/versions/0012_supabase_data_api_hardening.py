"""harden application tables against direct Data API access

Revision ID: 0012_data_api_hardening
Revises: 0011_seed_course_facts
Create Date: 2026-07-21
"""

from alembic import op


revision = "0012_data_api_hardening"
down_revision = "0011_seed_course_facts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        """
        DO $$
        DECLARE
            app_table record;
            api_role text;
        BEGIN
            FOR app_table IN
                SELECT schemaname, tablename
                FROM pg_tables
                WHERE schemaname = 'public'
            LOOP
                EXECUTE format(
                    'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                    app_table.schemaname,
                    app_table.tablename
                );
            END LOOP;

            FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
            LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                    EXECUTE format(
                        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
                        api_role
                    );
                    EXECUTE format(
                        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
                        api_role
                    );
                    EXECUTE format(
                        'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',
                        api_role
                    );
                    EXECUTE format(
                        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                        'REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                        api_role
                    );
                    EXECUTE format(
                        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                        'REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                        api_role
                    );
                    EXECUTE format(
                        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                        'REVOKE EXECUTE ON FUNCTIONS FROM %I',
                        api_role
                    );
                END IF;
            END LOOP;
        END
        $$;

        REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
        """
    )


def downgrade() -> None:
    # Security boundaries are intentionally retained. Automatically restoring
    # broad Data API grants or disabling RLS would be an unsafe downgrade.
    pass
