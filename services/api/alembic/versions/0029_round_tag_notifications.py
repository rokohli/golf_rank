"""add subject_id to app_notifications for per-round tag notifications

Revision ID: 0029_round_tag_notifications
Revises: 0028_moderation_concurrency
"""

from alembic import op
import sqlalchemy as sa


revision = "0029_round_tag_notifications"
down_revision = "0028_moderation_concurrency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_notifications", sa.Column("subject_id", sa.Integer(), nullable=True))
    op.create_index("ix_app_notifications_subject_id", "app_notifications", ["subject_id"])
    with op.batch_alter_table("app_notifications") as batch_op:
        batch_op.create_foreign_key(
            "fk_app_notifications_subject_id",
            "rounds",
            ["subject_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.drop_constraint("uq_notification_recipient_actor_type", type_="unique")

    # A single 4-column unique constraint would not dedupe subject_id-less
    # notifications (followed_you, contact_joined, mutual_follow) -- both
    # Postgres and SQLite treat every NULL as distinct. Two partial unique
    # indexes preserve the old one-per-actor guarantee for those, while
    # allowing one row per actor *per round* for round-scoped types.
    op.create_index(
        "uq_notification_recipient_actor_type_no_subject",
        "app_notifications",
        ["recipient_user_id", "actor_user_id", "notification_type"],
        unique=True,
        postgresql_where=sa.text("subject_id IS NULL"),
        sqlite_where=sa.text("subject_id IS NULL"),
    )
    op.create_index(
        "uq_notification_recipient_actor_type_subject",
        "app_notifications",
        ["recipient_user_id", "actor_user_id", "notification_type", "subject_id"],
        unique=True,
        postgresql_where=sa.text("subject_id IS NOT NULL"),
        sqlite_where=sa.text("subject_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_notification_recipient_actor_type_subject", table_name="app_notifications")
    op.drop_index("uq_notification_recipient_actor_type_no_subject", table_name="app_notifications")
    # Collapsing subject_id away means multiple per-round notifications for the
    # same (recipient, actor, type) pair -- e.g. two tagged_in_round rows from
    # being tagged in two different rounds -- can no longer coexist once the
    # old 3-column constraint comes back. Keep only the most recent row per
    # pair so that constraint doesn't fail against data this feature was
    # built to allow.
    op.execute(
        """
        DELETE FROM app_notifications
        WHERE id NOT IN (
            SELECT MAX(id) FROM app_notifications
            GROUP BY recipient_user_id, actor_user_id, notification_type
        )
        """
    )
    with op.batch_alter_table("app_notifications") as batch_op:
        batch_op.create_unique_constraint(
            "uq_notification_recipient_actor_type",
            ["recipient_user_id", "actor_user_id", "notification_type"],
        )
        batch_op.drop_constraint("fk_app_notifications_subject_id", type_="foreignkey")
    op.drop_index("ix_app_notifications_subject_id", table_name="app_notifications")
    op.drop_column("app_notifications", "subject_id")
