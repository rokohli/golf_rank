"""fix forebay and presidio course photos and metadata

Revision ID: 0024_fix_course_photos
Revises: 0023_course_image_round_link
Create Date: 2026-09-07
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_fix_course_photos"
down_revision = "0023_course_image_round_link"
branch_labels = None
depends_on = None

PRESIDIO_PLACE_ID = "ChIJOR1geCGHhYARQ484akGas0M"
FOREBAY_SOURCE_ID = "53d70641-7dc2-4205-ba6e-a5c43a57c3c3"
PRESIDIO_SOURCE_ID = "514d7002-95eb-415b-a7f8-babb1e35772e"


def upgrade() -> None:
    connection = op.get_bind()

    courses = sa.table(
        "courses",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("city", sa.String()),
        sa.column("region", sa.String()),
        sa.column("latitude", sa.Float()),
        sa.column("longitude", sa.Float()),
        sa.column("source", sa.String()),
        sa.column("source_course_id", sa.String()),
        sa.column("google_place_id", sa.String()),
    )

    course_images = sa.table(
        "course_images",
        sa.column("id", sa.Integer()),
        sa.column("course_id", sa.Integer()),
        sa.column("storage_key", sa.String()),
        sa.column("alt_text", sa.String()),
        sa.column("source_name", sa.String()),
        sa.column("source_url", sa.String()),
        sa.column("source_type", sa.String()),
        sa.column("moderation_status", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("is_hero", sa.Boolean()),
    )

    negative_cache = sa.table(
        "course_image_negative_cache",
        sa.column("course_id", sa.Integer()),
    )

    # 1. Look up Forebay and Presidio courses
    forebay = connection.execute(
        sa.select(courses.c.id).where(
            (courses.c.source_course_id == FOREBAY_SOURCE_ID) | (courses.c.name == "Forebay Golf Course")
        )
    ).mappings().first()

    presidio = connection.execute(
        sa.select(courses.c.id).where(
            (courses.c.source_course_id == PRESIDIO_SOURCE_ID) | (courses.c.name == "Presidio Golf Course")
        )
    ).mappings().first()

    if forebay is not None and presidio is not None:
        forebay_id = forebay["id"]
        presidio_id = presidio["id"]

        # Disassociate Google Place ID from Forebay and fix Forebay's true location
        connection.execute(
            courses.update()
            .where(courses.c.id == forebay_id)
            .values(
                google_place_id=None,
                city="Santa Nella",
                region="Santa Nella, CA",
                latitude=37.1017405,
                longitude=-121.0158768,
            )
        )

        # Assign Google Place ID to Presidio
        connection.execute(
            courses.update()
            .where(courses.c.id == presidio_id)
            .values(google_place_id=PRESIDIO_PLACE_ID)
        )

        # Shift any existing images on Presidio out of the way to avoid uq_course_image_position collisions
        connection.execute(
            course_images.update()
            .where(course_images.c.course_id == presidio_id)
            .values(position=course_images.c.position + 100)
        )

        # Move the Presidio photos from Forebay to Presidio
        forebay_presidio_images = connection.execute(
            sa.select(course_images.c.id, course_images.c.storage_key)
            .where(
                course_images.c.course_id == forebay_id,
                course_images.c.storage_key.isnot(None),
            )
            .order_by(course_images.c.position)
        ).mappings().all()

        for idx, row in enumerate(forebay_presidio_images):
            # storage_key is left untouched -- it's just a pointer into R2, not
            # derived from course_id, and no R2 object is copied by this
            # migration. Renaming it to a Presidio-prefixed key here would
            # point at bytes that were never moved, breaking the served URL
            # (see storage_image_url, which uses storage_key verbatim).
            connection.execute(
                course_images.update()
                .where(course_images.c.id == row["id"])
                .values(
                    course_id=presidio_id,
                    alt_text="Presidio Golf Course course photo",
                    source_type="official",
                    moderation_status="approved",
                    position=idx,
                    is_hero=(idx == 0),
                )
            )

        # Compact previously existing Presidio images to follow the newly added photos
        new_photo_count = len(forebay_presidio_images)
        connection.execute(
            course_images.update()
            .where(course_images.c.course_id == presidio_id, course_images.c.position >= 100)
            .values(position=course_images.c.position - 100 + new_photo_count)
        )

        # Clear negative cache for both courses
        connection.execute(
            sa.delete(negative_cache).where(
                negative_cache.c.course_id.in_([forebay_id, presidio_id])
            )
        )

    # 2. Update all remaining curated storage_key rows to 'official' source_type
    connection.execute(
        course_images.update()
        .where(course_images.c.storage_key.isnot(None), course_images.c.source_type == "wikimedia")
        .values(source_type="official")
    )

    # 3. Share TPC Harding Park Fleming Course's hero image with TPC Harding Park Harding Course
    fleming = connection.execute(
        sa.select(courses.c.id).where(
            (courses.c.source_course_id == "61fb03c8-74fc-4fc8-87d0-0491190e2d54")
            | (courses.c.name == "Tpc Harding Park Fleming Course")
        )
    ).mappings().first()

    harding = connection.execute(
        sa.select(courses.c.id).where(
            (courses.c.source_course_id == "21922834-62d3-4603-b624-b44867b60eb4")
            | (courses.c.name == "Tpc Harding Park Harding Course")
        )
    ).mappings().first()

    if fleming is not None and harding is not None:
        fleming_id = fleming["id"]
        harding_id = harding["id"]

        fleming_hero = connection.execute(
            sa.select(course_images).where(
                course_images.c.course_id == fleming_id,
                course_images.c.is_hero.is_(True),
            )
        ).mappings().first()

        # Reuse Fleming's actual storage_key rather than fabricating a new
        # courses/{harding_id}/... key: no R2 object is copied by this
        # migration, so a fabricated key would point at bytes that don't
        # exist. storage_key has no per-row uniqueness requirement -- two
        # rows sharing one physical object (an explicitly shared hero image)
        # is a supported shape, same as external_url rows sharing a URL.
        existing_harding_image = (
            connection.execute(
                sa.select(course_images.c.id).where(
                    course_images.c.course_id == harding_id,
                    course_images.c.storage_key == fleming_hero["storage_key"],
                )
            ).first()
            if fleming_hero is not None
            else None
        )

        if existing_harding_image is None and fleming_hero is not None:
            connection.execute(
                course_images.insert().values(
                    course_id=harding_id,
                    storage_key=fleming_hero["storage_key"],
                    alt_text="Tpc Harding Park Harding Course course photo",
                    source_name=fleming_hero["source_name"],
                    source_url=fleming_hero["source_url"],
                    position=0,
                    is_hero=True,
                    source_type="official",
                    moderation_status="approved",
                )
            )
            connection.execute(
                sa.delete(negative_cache).where(
                    negative_cache.c.course_id == harding_id
                )
            )


def downgrade() -> None:
    # Data corrections are intentionally non-destructive and not reverted.
    pass
