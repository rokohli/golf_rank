from collections.abc import Collection
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
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
    aspect ratio, then the *oldest* row. No AI/ML selection -- see spec
    section 28.

    The final tiebreak deliberately prefers the incumbent (oldest) rather than
    the newest row. The quality scorer emits integers 0-10, so ties are common,
    and newest-first would rotate a course's hero to the most recent
    equally-scored upload every time one landed -- churn on the course page
    with no gain in quality and no human involved. Preferring the older row
    means an automatically-approved hero is displaced only by a *strictly
    higher* score. A human's explicit pick is unaffected either way: is_hero is
    the first term and dominates every other.

    Mirrored in apps/frontend/src/coursePresentation.ts -- change both together.
    """
    return (
        0 if image.is_hero else 1,
        -(image.quality_score if image.quality_score is not None else -1.0),
        _aspect_penalty(image),
        image.created_at.timestamp() if image.created_at else 0.0,
        image.id,
    )


class CourseImageRepository:
    def approved_images(self, session: Session, course_id: int, source_type: str) -> list[CourseImage]:
        """All APPROVED rows in one source tier, best candidate first."""
        candidates = session.scalars(
            select(CourseImage).where(
                CourseImage.course_id == course_id,
                CourseImage.source_type == source_type,
                CourseImage.moderation_status == CourseImageModeration.APPROVED,
            )
        ).all()
        return sorted(candidates, key=_rank_key)

    def _best_approved(self, session: Session, course_id: int, source_type: str) -> CourseImage | None:
        candidates = self.approved_images(session, course_id, source_type)
        return candidates[0] if candidates else None

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

    def find_by_storage_key(self, session: Session, storage_key: str) -> CourseImage | None:
        return session.scalar(select(CourseImage).where(CourseImage.storage_key == storage_key))

    def add_user_image(
        self, session: Session, course_id: int, *,
        storage_key: str, uploaded_by_user_id: int,
        alt_text: str | None = None, width: int | None = None, height: int | None = None,
        round_id: int | None = None,
    ) -> CourseImage:
        """Persists a user-submitted upload as PENDING -- it's immediately visible
        in the course's photo gallery (course_image_data doesn't filter on
        moderation_status), but stays ineligible for resolve_hero_image (via
        approved_images) until moderation flips moderation_status to APPROVED --
        either an admin action (course_photo_moderation.py) or the quality
        scorer's auto-approval. round_id, when present, is a separate axis: it makes the
        photo visible on that round's feed posting
        immediately, regardless of moderation_status.

        Idempotent on storage_key (unique, uq_course_image_user_storage_key): a
        replayed confirm for an already-confirmed key returns the existing
        row instead of creating a duplicate gallery entry / consuming another
        round-photo slot. Callers must still verify the existing row's
        uploaded_by_user_id belongs to the caller."""
        existing = self.find_by_storage_key(session, storage_key)
        if existing is not None:
            return existing
        # next_position() is a plain read-then-write, so two concurrent uploads
        # to the same course can compute the same position and race on
        # uq_course_image_position. Retry with a freshly-read position rather
        # than locking the whole course's image rows on every upload -- a
        # collision here is rare, so paying for a lock on the common path
        # isn't worth it.
        for attempt in range(3):
            image = CourseImage(
                course_id=course_id,
                storage_key=storage_key,
                alt_text=alt_text,
                position=self.next_position(session, course_id),
                is_hero=False,
                source_type=CourseImageSource.USER,
                moderation_status=CourseImageModeration.PENDING,
                uploaded_by_user_id=uploaded_by_user_id,
                width=width,
                height=height,
                round_id=round_id,
            )
            session.add(image)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                # Either the position collided (retry with a fresh position) or
                # a concurrent request already confirmed this exact storage_key
                # (uq_course_image_user_storage_key) -- in that case return the row
                # it created instead of raising or looping pointlessly.
                existing = self.find_by_storage_key(session, storage_key)
                if existing is not None:
                    return existing
                if attempt == 2:
                    raise
                continue
            session.refresh(image)
            return image
        raise AssertionError("unreachable")

    # --- moderation -------------------------------------------------------

    def has_featured_hero(self, session: Session, course_id: int) -> bool:
        """True when a human has explicitly featured an OFFICIAL or USER photo
        for this course.

        Used to skip quality scoring: is_hero is _rank_key's first term, so
        while one is set no score can change which photo wins its tier, and
        scoring a new upload would buy nothing but a number in the moderation
        queue. WIKIMEDIA is excluded deliberately -- add_wikimedia_image sets
        is_hero unconditionally on every cached row, so counting it would treat
        almost every course as locked.
        """
        return session.scalar(
            select(select(CourseImage.id).where(
                CourseImage.course_id == course_id,
                CourseImage.source_type.in_((CourseImageSource.OFFICIAL, CourseImageSource.USER)),
                CourseImage.is_hero.is_(True),
            ).exists())
        ) or False

    def moderation_queue(
        self, session: Session, *, status: str, course_id: int | None = None,
        cursor: int | None = None, limit: int = 50,
    ) -> list[CourseImage]:
        """One page of the moderation queue, oldest first (a queue is FIFO,
        unlike the feed). Scoped to USER rows: OFFICIAL and WIKIMEDIA photos are
        curated by the offline scripts and must never be moderated here.

        Keyset pagination on id rather than OFFSET -- created_at can tie across
        rows inserted in the same transaction, so id is the stable cursor.
        """
        query = select(CourseImage).where(
            CourseImage.source_type == CourseImageSource.USER,
            CourseImage.moderation_status == status,
        )
        if course_id is not None:
            query = query.where(CourseImage.course_id == course_id)
        if cursor is not None:
            query = query.where(CourseImage.id > cursor)
        return list(session.scalars(
            query.order_by(CourseImage.id).limit(limit)
        ).all())

    def lock_image_for_moderation(self, session: Session, image_id: int) -> CourseImage | None:
        """Loads a USER photo FOR UPDATE so concurrent moderator actions on the
        same row serialize instead of racing.

        SQLite ignores FOR UPDATE silently, so this lock is only real on
        Postgres -- tests/test_concurrency_locks.py compiles the statement
        against the Postgres dialect to prove the clause is still emitted.
        """
        return session.scalar(
            select(CourseImage).where(
                CourseImage.id == image_id,
                CourseImage.source_type == CourseImageSource.USER,
            ).with_for_update()
        )

    def set_moderation(
        self, session: Session, image: CourseImage, *, status: str,
        moderated_by_user_id: int | None, reason: str | None = None,
    ) -> CourseImage:
        """Records a moderation decision. moderated_by_user_id is None for an
        automatic (scorer) decision -- see CourseImage.moderated_by_user_id.

        Clears is_hero when rejecting: is_hero is _rank_key's first term, so a
        rejected row that kept it would leap straight back to the top of its
        tier the moment anyone re-approved it.
        """
        image.moderation_status = status
        image.moderated_by_user_id = moderated_by_user_id
        image.moderated_at = datetime.now(timezone.utc)
        image.moderation_reason = reason
        if status == CourseImageModeration.REJECTED:
            image.is_hero = False
        session.commit()
        session.refresh(image)
        return image

    def set_featured(self, session: Session, image: CourseImage, featured: bool) -> CourseImage:
        """Sets or clears the explicit hero pick within this photo's source tier.

        Enforces "at most one is_hero per (course, source_type)" for the tier it
        touches. No database constraint backs that invariant and nothing
        historically maintained it -- add_wikimedia_image sets is_hero
        unconditionally, so courses can already have several. _rank_key degrades
        gracefully when it's violated (it falls through to quality_score), which
        is why this repairs rather than rejects: featuring one row clears every
        sibling in the same tier, including a pre-existing duplicate.

        Only the target's own tier is touched -- clearing another tier's hero
        would silently change which photo that tier contributes to
        CourseImageService._resolve.
        """
        if featured:
            for sibling in session.scalars(
                select(CourseImage).where(
                    CourseImage.course_id == image.course_id,
                    CourseImage.source_type == image.source_type,
                    CourseImage.id != image.id,
                ).with_for_update()
            ).all():
                sibling.is_hero = False
        image.is_hero = featured
        session.commit()
        session.refresh(image)
        return image

    def record_score(
        self, session: Session, image: CourseImage, *, score: float, reasons: list[str],
    ) -> CourseImage:
        image.quality_score = score
        image.quality_score_reasons = reasons
        image.scored_at = datetime.now(timezone.utc)
        image.scoring_attempts = (image.scoring_attempts or 0) + 1
        session.commit()
        session.refresh(image)
        return image

    def record_score_failure(self, session: Session, image: CourseImage) -> CourseImage:
        """Counts a failed scoring attempt without marking the photo scored.

        scored_at stays NULL so the sweeper picks the row up again;
        scoring_attempts is what eventually stops it retrying a permanently
        broken image forever.
        """
        image.scoring_attempts = (image.scoring_attempts or 0) + 1
        session.commit()
        session.refresh(image)
        return image

    def count_for_round(self, session: Session, round_id: int) -> int:
        return session.scalar(
            select(func.count()).select_from(CourseImage).where(CourseImage.round_id == round_id)
        ) or 0

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

    def invalidate_negative_cache_bulk(
        self, session: Session, course_ids: Collection[int], *, commit: bool = True
    ) -> None:
        """Same as invalidate_negative_cache, but for many courses in one
        statement -- e.g. a catalog import that relocates hundreds of courses
        in one run shouldn't pay a SELECT+delete round trip per course."""
        if not course_ids:
            return
        session.execute(delete(CourseImageNegativeCache).where(CourseImageNegativeCache.course_id.in_(course_ids)))
        if commit:
            session.commit()
