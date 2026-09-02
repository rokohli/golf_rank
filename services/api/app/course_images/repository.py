from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import CourseImage, CourseImageModeration, CourseImageNegativeCache, CourseImageSource

IDEAL_HERO_ASPECT_RATIO = 16 / 9


def _aspect_penalty(image: CourseImage) -> float:
    """Lower is better. Missing dimensions are a mild penalty, not disqualifying."""
    if not image.width or not image.height:
        return 1.0
    return abs((image.width / image.height) - IDEAL_HERO_ASPECT_RATIO)


def _rank_key(image: CourseImage):
    """Deterministic ranking within one source tier (OFFICIAL or USER):
    featured beats non-featured, then quality score, then a hero-compatible
    aspect ratio, then recency. No AI/ML selection -- see spec section 28.
    """
    return (
        0 if image.is_hero else 1,
        -(image.quality_score if image.quality_score is not None else -1.0),
        _aspect_penalty(image),
        -(image.created_at.timestamp() if image.created_at else 0.0),
        image.id,
    )


class CourseImageRepository:
    def _best_approved(self, session: Session, course_id: int, source_type: str) -> CourseImage | None:
        candidates = session.scalars(
            select(CourseImage).where(
                CourseImage.course_id == course_id,
                CourseImage.source_type == source_type,
                CourseImage.moderation_status == CourseImageModeration.APPROVED,
            )
        ).all()
        if not candidates:
            return None
        return min(candidates, key=_rank_key)

    def best_official_image(self, session: Session, course_id: int) -> CourseImage | None:
        return self._best_approved(session, course_id, CourseImageSource.OFFICIAL)

    def best_user_image(self, session: Session, course_id: int) -> CourseImage | None:
        return self._best_approved(session, course_id, CourseImageSource.USER)

    def best_wikimedia_image(self, session: Session, course_id: int) -> CourseImage | None:
        return self._best_approved(session, course_id, CourseImageSource.WIKIMEDIA)

    def next_position(self, session: Session, course_id: int) -> int:
        """Next `CourseImage.position` for a course: one past the current max, or 0."""
        current_max = session.scalar(
            select(CourseImage.position).where(CourseImage.course_id == course_id).order_by(CourseImage.position.desc())
        )
        return (current_max + 1) if current_max is not None else 0

    def wikimedia_images(self, session: Session, course_id: int) -> list[CourseImage]:
        return list(session.scalars(
            select(CourseImage).where(
                CourseImage.course_id == course_id,
                CourseImage.source_type == CourseImageSource.WIKIMEDIA,
            ).order_by(CourseImage.position)
        ).all())

    def delete_wikimedia_images(self, session: Session, course_id: int, *, commit: bool = True) -> None:
        """Deletes only this course's Wikimedia-tier rows -- OFFICIAL/USER photos
        are curated and must survive a refresh or a low-quality-score removal."""
        session.execute(delete(CourseImage).where(
            CourseImage.course_id == course_id,
            CourseImage.source_type == CourseImageSource.WIKIMEDIA,
        ))
        if commit:
            session.commit()

    def delete_image(self, session: Session, image: CourseImage, *, commit: bool = True) -> None:
        """Deletes a single CourseImage row without affecting other images."""
        session.delete(image)
        if commit:
            session.commit()

    def update_wikimedia_image(
        self,
        session: Session,
        image: CourseImage,
        *,
        external_url: str,
        thumbnail_url: str,
        alt_text: str,
        source_name: str | None,
        source_url: str | None,
        license_name: str | None,
        license_url: str | None,
        width: int | None,
        height: int | None,
    ) -> None:
        """Updates an existing Wikimedia row in place (e.g. refreshing a stale
        cached hero), preserving its position, is_hero flag, and any other gallery
        rows for the course."""
        image.external_url = external_url
        image.thumbnail_url = thumbnail_url
        image.alt_text = alt_text
        image.source_name = source_name
        image.source_url = source_url
        image.license_name = license_name
        image.license_url = license_url
        image.width = width
        image.height = height
        image.created_at = datetime.now(timezone.utc)
        image.updated_at = datetime.now(timezone.utc)
        session.commit()

    def add_wikimedia_image(self, session: Session, course_id: int, *, external_url, thumbnail_url, alt_text,
                             source_name, source_url, license_name, license_url, width, height) -> None:
        """Persists a freshly-resolved Wikimedia match as the cached result for
        next time -- this table row *is* the "cached Wikimedia result" from the
        spec; there's no separate positive-result cache to keep in sync."""
        session.add(CourseImage(
            course_id=course_id,
            external_url=external_url,
            thumbnail_url=thumbnail_url,
            alt_text=alt_text,
            source_name=source_name,
            source_url=source_url,
            license_name=license_name,
            license_url=license_url,
            position=self.next_position(session, course_id),
            is_hero=True,
            source_type=CourseImageSource.WIKIMEDIA,
            moderation_status=CourseImageModeration.APPROVED,
            width=width,
            height=height,
        ))
        session.commit()

    def get_negative_cache(self, session: Session, course_id: int, provider: str) -> CourseImageNegativeCache | None:
        row = session.scalar(
            select(CourseImageNegativeCache).where(
                CourseImageNegativeCache.course_id == course_id,
                CourseImageNegativeCache.provider == provider,
            )
        )
        if row is None:
            return None
        expires_at = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return None
        return row

    def set_negative_cache(self, session: Session, course_id: int, provider: str, *, ttl_seconds: int) -> None:
        from datetime import timedelta

        existing = session.scalar(
            select(CourseImageNegativeCache).where(
                CourseImageNegativeCache.course_id == course_id,
                CourseImageNegativeCache.provider == provider,
            )
        )
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
        if existing is not None:
            existing.checked_at = datetime.now(timezone.utc)
            existing.expires_at = expires_at
        else:
            session.add(CourseImageNegativeCache(course_id=course_id, provider=provider, expires_at=expires_at))
        session.commit()

    def invalidate_negative_cache(
        self, session: Session, course_id: int, provider: str | None = None, *, commit: bool = True
    ) -> None:
        """Called when the fact that made a negative result stale changes --
        e.g. a course's coordinates are corrected (see catalog_import.py).

        `commit=False` lets a caller batch this into a larger transaction
        (catalog_import.py commits once at the end of the whole import run).
        """
        query = select(CourseImageNegativeCache).where(CourseImageNegativeCache.course_id == course_id)
        if provider is not None:
            query = query.where(CourseImageNegativeCache.provider == provider)
        for row in session.scalars(query).all():
            session.delete(row)
        if commit:
            session.commit()
