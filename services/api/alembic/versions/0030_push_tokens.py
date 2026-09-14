"""add push_tokens for Expo push-notification delivery

Revision ID: 0030_push_tokens
Revises: 0029_round_tag_notifications
"""

from alembic import op
import sqlalchemy as sa


revision = "0030_push_tokens"
down_revision = "0029_round_tag_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("token", name="uq_push_tokens_token"),
    )
    op.create_index("ix_push_tokens_user_id", "push_tokens", ["user_id"])
    op.create_index("ix_push_tokens_token", "push_tokens", ["token"])

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
            REVOKE ALL PRIVILEGES ON TABLE push_tokens FROM PUBLIC;
            REVOKE ALL PRIVILEGES ON SEQUENCE push_tokens_id_seq FROM PUBLIC;
            DO $$
            DECLARE
                api_role text;
            BEGIN
                FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
                LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON TABLE push_tokens FROM %I',
                            api_role
                        );
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON SEQUENCE push_tokens_id_seq FROM %I',
                            api_role
                        );
                    END IF;
                END LOOP;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fairway_api') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_tokens
                        TO fairway_api;
                    GRANT USAGE, SELECT ON SEQUENCE push_tokens_id_seq
                        TO fairway_api;
                    CREATE POLICY push_tokens_fairway_api
                        ON push_tokens
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
    op.drop_index("ix_push_tokens_token", table_name="push_tokens")
    op.drop_index("ix_push_tokens_user_id", table_name="push_tokens")
    op.drop_table("push_tokens")
