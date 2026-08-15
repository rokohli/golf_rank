"""add persistent notifications and privacy-safe contact links

Revision ID: 0016_notifications_contacts
Revises: 0015_ai_plan_generations
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_notifications_contacts"
down_revision = "0015_ai_plan_generations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("linked_contacts", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("identifier_hash", sa.String(length=64), nullable=False), sa.UniqueConstraint("user_id", "identifier_hash", name="uq_linked_contact_user_hash"))
    op.create_index("ix_linked_contacts_user_id", "linked_contacts", ["user_id"])
    op.create_index("ix_linked_contacts_identifier_hash", "linked_contacts", ["identifier_hash"])
    op.create_table("app_notifications", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("recipient_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("notification_type", sa.String(length=40), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.UniqueConstraint("recipient_user_id", "actor_user_id", "notification_type", name="uq_notification_recipient_actor_type"))
    op.create_index("ix_app_notifications_recipient_user_id", "app_notifications", ["recipient_user_id"])
    op.create_index("ix_app_notifications_actor_user_id", "app_notifications", ["actor_user_id"])
    op.create_index("ix_app_notifications_notification_type", "app_notifications", ["notification_type"])
    op.create_index("ix_app_notifications_created_at", "app_notifications", ["created_at"])


def downgrade() -> None:
    for name in ["ix_app_notifications_created_at", "ix_app_notifications_notification_type", "ix_app_notifications_actor_user_id", "ix_app_notifications_recipient_user_id"]: op.drop_index(name, table_name="app_notifications")
    op.drop_table("app_notifications")
    for name in ["ix_linked_contacts_identifier_hash", "ix_linked_contacts_user_id"]: op.drop_index(name, table_name="linked_contacts")
    op.drop_table("linked_contacts")
