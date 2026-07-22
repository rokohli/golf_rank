"""make OpenGolfAPI authoritative for legacy fixture courses

Revision ID: 0014_provider_first_catalog
Revises: 0013_canonical_course_identity
Create Date: 2026-07-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_provider_first_catalog"
down_revision = "0013_canonical_course_identity"
branch_labels = None
depends_on = None


PROVIDER_IDENTITIES = {
    "pebble": "40977ee8-33ee-4195-b6a2-99a4ca83c2bc",
    "spyglass": "315fb576-129c-4508-abfa-561d8fbf2904",
    "pasatiempo": "99f368a1-ea6a-403a-baca-ca235cb657cf",
}

COURSE_REFERENCE_COLUMNS = (
    ("comparisons", "course_a_id"),
    ("comparisons", "course_b_id"),
    ("comparisons", "preferred_course_id"),
    ("course_images", "course_id"),
    ("itinerary_items", "course_id"),
    ("plan_candidates", "course_id"),
    ("ranking_confidences", "course_id"),
    ("rounds", "course_id"),
    ("saved_courses", "course_id"),
    ("tier_assignments", "course_id"),
    ("user_course_ratings", "course_id"),
    ("user_course_states", "course_id"),
)


def _courses():
    return sa.table(
        "courses",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("region", sa.String()),
        sa.column("latitude", sa.Float()),
        sa.column("longitude", sa.Float()),
        sa.column("is_public", sa.Boolean()),
        sa.column("difficulty", sa.String()),
        sa.column("green_fee", sa.Integer()),
        sa.column("source", sa.String()),
        sa.column("source_course_id", sa.String()),
        sa.column("google_place_id", sa.String()),
        sa.column("country_code", sa.String()),
        sa.column("admin1_code", sa.String()),
        sa.column("admin1_name", sa.String()),
        sa.column("city", sa.String()),
        sa.column("facility_name", sa.String()),
        sa.column("course_name", sa.String()),
        sa.column("status", sa.String()),
        sa.column("hole_count", sa.Integer()),
        sa.column("par", sa.Integer()),
        sa.column("slope_rating", sa.Integer()),
        sa.column("tee_time_url", sa.String()),
        sa.column("access", sa.String()),
        sa.column("source_updated_at", sa.DateTime(timezone=True)),
        sa.column("last_verified_at", sa.DateTime(timezone=True)),
    )


def _assert_provider_row_is_unreferenced(connection, provider_id: int) -> None:
    for table_name, column_name in COURSE_REFERENCE_COLUMNS:
        count = connection.scalar(sa.text(
            f"SELECT COUNT(*) FROM {table_name} WHERE {column_name} = :course_id"
        ), {"course_id": provider_id})
        if count:
            raise RuntimeError(
                "Provider-first conversion would discard relationship rows: "
                f"{table_name}.{column_name} references course {provider_id}"
            )


def _preferred_value(primary: dict, fallback: dict, key: str):
    return primary[key] if primary[key] is not None else fallback[key]


def upgrade() -> None:
    connection = op.get_bind()
    courses = _courses()
    reconciliations = sa.table(
        "course_reconciliations",
        sa.column("source", sa.String()),
        sa.column("source_course_id", sa.String()),
        sa.column("canonical_course_id", sa.Integer()),
    )

    for seed_identity, provider_identity in PROVIDER_IDENTITIES.items():
        seed = connection.execute(sa.select(courses).where(
            courses.c.source == "seed",
            courses.c.source_course_id == seed_identity,
        )).mappings().first()
        provider = connection.execute(sa.select(courses).where(
            courses.c.source == "opengolfapi",
            courses.c.source_course_id == provider_identity,
        )).mappings().first()
        if seed is None or provider is None or seed["id"] == provider["id"]:
            continue

        provider_id = provider["id"]
        _assert_provider_row_is_unreferenced(connection, provider_id)
        provider_is_canonical = connection.scalar(sa.select(sa.literal(1)).select_from(
            reconciliations
        ).where(reconciliations.c.canonical_course_id == provider_id).limit(1))
        if provider_is_canonical is not None:
            raise RuntimeError(
                f"Provider course {provider_id} is canonical for another source mapping"
            )
        mapped_canonical_id = connection.scalar(sa.select(
            reconciliations.c.canonical_course_id
        ).where(
            reconciliations.c.source == "opengolfapi",
            reconciliations.c.source_course_id == provider_identity,
        ))
        if mapped_canonical_id is not None and mapped_canonical_id != seed["id"]:
            raise RuntimeError(
                "Provider-first conversion conflicts with an explicit canonical "
                f"mapping for opengolfapi:{provider_identity}"
            )

        connection.execute(sa.delete(reconciliations).where(
            reconciliations.c.source == "opengolfapi",
            reconciliations.c.source_course_id == provider_identity,
        ))
        connection.execute(sa.delete(courses).where(courses.c.id == provider_id))

        provider = dict(provider)
        seed = dict(seed)
        connection.execute(sa.update(courses).where(
            courses.c.id == seed["id"]
        ).values(
            name=_preferred_value(provider, seed, "name"),
            region=_preferred_value(provider, seed, "region"),
            latitude=_preferred_value(provider, seed, "latitude"),
            longitude=_preferred_value(provider, seed, "longitude"),
            is_public=_preferred_value(provider, seed, "is_public"),
            difficulty=_preferred_value(seed, provider, "difficulty"),
            green_fee=_preferred_value(seed, provider, "green_fee"),
            source="opengolfapi",
            source_course_id=provider_identity,
            google_place_id=_preferred_value(provider, seed, "google_place_id"),
            country_code=_preferred_value(provider, seed, "country_code"),
            admin1_code=_preferred_value(provider, seed, "admin1_code"),
            admin1_name=_preferred_value(provider, seed, "admin1_name"),
            city=_preferred_value(provider, seed, "city"),
            facility_name=_preferred_value(provider, seed, "facility_name"),
            course_name=_preferred_value(provider, seed, "course_name"),
            status=_preferred_value(provider, seed, "status"),
            hole_count=_preferred_value(provider, seed, "hole_count"),
            par=_preferred_value(provider, seed, "par"),
            slope_rating=_preferred_value(seed, provider, "slope_rating"),
            tee_time_url=_preferred_value(seed, provider, "tee_time_url"),
            access=_preferred_value(provider, seed, "access"),
            source_updated_at=provider["source_updated_at"],
            last_verified_at=provider["last_verified_at"],
        ))


def downgrade() -> None:
    # The conversion intentionally preserves stable course IDs and every row
    # that referenced the legacy fixture. Recreating competing seed/provider
    # rows on downgrade would reintroduce duplicates and make relationship
    # ownership ambiguous, so this data migration is non-destructive.
    pass
