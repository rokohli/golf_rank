"""enforce one canonical mapping per source course

Revision ID: 0013_canonical_course_identity
Revises: 0012_data_api_hardening
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_canonical_course_identity"
down_revision = "0012_data_api_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    duplicate = op.get_bind().exec_driver_sql(
        """
        SELECT source, source_course_id
        FROM course_reconciliations
        GROUP BY source, source_course_id
        HAVING COUNT(*) > 1
        LIMIT 1
        """
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "Resolve duplicate course reconciliation mappings before upgrading: "
            f"{duplicate[0]}:{duplicate[1]}"
        )
    with op.batch_alter_table("course_reconciliations") as batch_op:
        batch_op.drop_constraint("uq_course_reconciliation", type_="unique")
        batch_op.create_unique_constraint(
            "uq_course_reconciliation", ["source", "source_course_id"]
        )
    connection = op.get_bind()
    alias_id = connection.scalar(sa.text(
        """
        SELECT id FROM courses
        WHERE source = 'opengolfapi'
          AND source_course_id = '40977ee8-33ee-4195-b6a2-99a4ca83c2bc'
        """
    ))
    canonical_id = connection.scalar(sa.text(
        """
        SELECT id FROM courses
        WHERE source = 'seed' AND source_course_id = 'pebble'
        """
    ))
    if alias_id is not None and canonical_id is not None and alias_id != canonical_id:
        connection.execute(
            sa.text(
                """
                INSERT INTO course_reconciliations (
                    source, source_course_id, canonical_course_id,
                    match_status, match_data
                )
                VALUES (
                    'opengolfapi',
                    '40977ee8-33ee-4195-b6a2-99a4ca83c2bc',
                    :canonical_id,
                    'confirmed',
                    CAST(:match_data AS json)
                )
                ON CONFLICT (source, source_course_id) DO NOTHING
                """
            ),
            {
                "canonical_id": canonical_id,
                "match_data": '{"migration":"0013_canonical_course_identity",'
                '"evidence":"exact provider ID, name, coordinates, and par"}',
            },
        )


def downgrade() -> None:
    op.get_bind().execute(sa.text(
        """
        DELETE FROM course_reconciliations
        WHERE source = 'opengolfapi'
          AND source_course_id = '40977ee8-33ee-4195-b6a2-99a4ca83c2bc'
          AND match_data ->> 'migration' = '0013_canonical_course_identity'
        """
    ))
    with op.batch_alter_table("course_reconciliations") as batch_op:
        batch_op.drop_constraint("uq_course_reconciliation", type_="unique")
        batch_op.create_unique_constraint(
            "uq_course_reconciliation",
            ["source", "source_course_id", "canonical_course_id"],
        )
