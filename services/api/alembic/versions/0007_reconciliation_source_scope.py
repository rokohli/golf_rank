"""scope course reconciliation identities by source

Revision ID: 0007_reconciliation_source_scope
Revises: 0006_social_catalog
Create Date: 2026-07-15
"""

from alembic import op


revision = "0007_reconciliation_source_scope"
down_revision = "0006_social_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("course_reconciliations") as batch_op:
        batch_op.drop_constraint("uq_course_reconciliation", type_="unique")
        batch_op.create_unique_constraint(
            "uq_course_reconciliation", ["source", "source_course_id", "canonical_course_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("course_reconciliations") as batch_op:
        batch_op.drop_constraint("uq_course_reconciliation", type_="unique")
        batch_op.create_unique_constraint(
            "uq_course_reconciliation", ["source_course_id", "canonical_course_id"]
        )
