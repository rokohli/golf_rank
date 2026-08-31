"""prevent deleted-account recreation and retain image license metadata

Revision ID: 0021_deleted_identities
Revises: 0020_cascade_delete_user_rows
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_deleted_identities"
down_revision = "0020_cascade_delete_user_rows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deleted_identities",
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("provider_subject"),
    )
    op.add_column("course_images", sa.Column("license_name", sa.String(length=120), nullable=True))
    op.add_column("course_images", sa.Column("license_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("course_images", "license_url")
    op.drop_column("course_images", "license_name")
    op.drop_table("deleted_identities")
