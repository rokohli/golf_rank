"""backfill enriched facts for legacy seed rows

Revision ID: 0011_seed_course_facts
Revises: 0010_course_detail_enrichment
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op


revision = "0011_seed_course_facts"
down_revision = "0010_course_detail_enrichment"
branch_labels = None
depends_on = None


LEGACY_SEEDS = {
    "Pebble Beach Golf Links": {
        "source_course_id": "pebble",
        "city": "Monterey",
        "hole_count": 18,
        "par": 72,
        "slope_rating": 145,
        "tee_time_url": "https://www.pebblebeach.com/plan-my-trip/preview-availability/",
    },
    "Spyglass Hill Golf Course": {
        "source_course_id": "spyglass",
        "city": "Monterey",
        "hole_count": 18,
        "par": 72,
        "slope_rating": 145,
        "tee_time_url": "https://www.pebblebeach.com/plan-my-trip/preview-availability/",
    },
    "Pasatiempo Golf Club": {
        "source_course_id": "pasatiempo",
        "city": "Santa Cruz",
        "hole_count": 18,
        "par": 70,
        "slope_rating": 141,
        "tee_time_url": "https://www.pasatiempo.com/golf/rates",
    },
}


def upgrade() -> None:
    courses = sa.table(
        "courses",
        sa.column("name", sa.String()),
        sa.column("source", sa.String()),
        sa.column("source_course_id", sa.String()),
        sa.column("country_code", sa.String()),
        sa.column("admin1_code", sa.String()),
        sa.column("admin1_name", sa.String()),
        sa.column("city", sa.String()),
        sa.column("course_name", sa.String()),
        sa.column("access", sa.String()),
        sa.column("hole_count", sa.Integer()),
        sa.column("par", sa.Integer()),
        sa.column("slope_rating", sa.Integer()),
        sa.column("tee_time_url", sa.String()),
    )
    connection = op.get_bind()
    for name, values in LEGACY_SEEDS.items():
        connection.execute(
            courses.update()
            .where(
                courses.c.name == name,
                courses.c.source == "seed",
                courses.c.source_course_id.is_(None),
            )
            .values(
                **values,
                country_code="US",
                admin1_code="CA",
                admin1_name="California",
                course_name=name,
                access="public",
            )
        )


def downgrade() -> None:
    courses = sa.table(
        "courses",
        sa.column("source", sa.String()),
        sa.column("source_course_id", sa.String()),
        sa.column("par", sa.Integer()),
        sa.column("slope_rating", sa.Integer()),
        sa.column("tee_time_url", sa.String()),
    )
    connection = op.get_bind()
    for values in LEGACY_SEEDS.values():
        connection.execute(
            courses.update()
            .where(
                courses.c.source == "seed",
                courses.c.source_course_id == values["source_course_id"],
            )
            .values(par=None, slope_rating=None, tee_time_url=None)
        )
