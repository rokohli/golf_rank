"""clean provider trademark artifacts from course names

Revision ID: 0009_clean_course_names
Revises: 0008_round_history
Create Date: 2026-07-17
"""

import sqlalchemy as sa
from alembic import op


revision = "0009_clean_course_names"
down_revision = "0008_round_history"
branch_labels = None
depends_on = None


COURSE_NAME_FIXES = {
    "Del Montetm Golf Course": "Del Monte Golf Course",
    "Spyglass Hilltm Golf Course": "Spyglass Hill Golf Course",
    "The Haytm": "The Hay",
    "The Links At Spanish Baytm": "The Links At Spanish Bay",
}


def upgrade() -> None:
    courses = sa.table(
        "courses",
        sa.column("source", sa.String()),
        sa.column("name", sa.String()),
        sa.column("course_name", sa.String()),
    )
    connection = op.get_bind()
    for old_name, corrected_name in COURSE_NAME_FIXES.items():
        connection.execute(
            courses.update()
            .where(courses.c.source == "opengolfapi", courses.c.name == old_name)
            .values(name=corrected_name, course_name=corrected_name)
        )


def downgrade() -> None:
    # Corrected catalog names intentionally remain corrected on downgrade.
    pass
