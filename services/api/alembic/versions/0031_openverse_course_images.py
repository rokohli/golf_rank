"""add openverse provenance/scoring columns to course_images

Revision ID: 0031_openverse_course_images
Revises: 0030_push_tokens
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_openverse_course_images"
down_revision = "0030_push_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_images", sa.Column("provider_asset_id", sa.String(length=255), nullable=True))
    op.add_column("course_images", sa.Column("creator_name", sa.String(length=255), nullable=True))
    op.add_column("course_images", sa.Column("creator_url", sa.String(length=2048), nullable=True))
    op.add_column("course_images", sa.Column("match_confidence_score", sa.Integer(), nullable=True))
    op.add_column("course_images", sa.Column("match_score_reasons", sa.JSON(), nullable=True))
    op.add_column("course_images", sa.Column("matched_query", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("course_images", "matched_query")
    op.drop_column("course_images", "match_score_reasons")
    op.drop_column("course_images", "match_confidence_score")
    op.drop_column("course_images", "creator_url")
    op.drop_column("course_images", "creator_name")
    op.drop_column("course_images", "provider_asset_id")
