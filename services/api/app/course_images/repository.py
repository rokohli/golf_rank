from collections.abc import Collection
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    CourseImage,
    CourseImageModeration,
    CourseImageModerationAction,
    CourseImageNegativeCache,
    CourseImageSource,
)

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

    def batch_has_featured_hero(self, session: Session, course_ids: Collection[int]) -> set[int]:
        """Returns the set of course_ids from course_ids that have an explicit
        human-featured hero in OFFICIAL or USER tiers, executed in a single query."""
        if not course_ids:
            return set()
        return set(session.scalars(
            select(CourseImage.course_id).where(
                CourseImage.course_id.in_(course_ids),
                CourseImage.source_type.in_((CourseImageSource.OFFICIAL, CourseImageSource.USER)),
                CourseImage.is_hero.is_(True),
            ).distinct()
        ).all())

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
        action: str | None = None,
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
        if action:
            image.moderation_action = action
        elif status == CourseImageModeration.APPROVED:
            image.moderation_action = (
                CourseImageModerationAction.APPROVED
                if moderated_by_user_id is not None
                else CourseImageModerationAction.AUTO_APPROVED
            )
        elif status == CourseImageModeration.REJECTED:
            image.moderation_action = CourseImageModerationAction.REJECTED

        if status == CourseImageModeration.REJECTED:
            image.is_hero = False
        session.commit()
        session.refresh(image)
        return image

    def feature_user_image(
        self, session: Session, image_id: int, *, featured: bool, moderator_user_id: int,
    ) -> CourseImage | None:
        """Features or unfeatures a USER photo with deterministic tier locking.

        To prevent PostgreSQL deadlocks between concurrent feature requests, locks all
        USER-tier rows for this course in strict deterministic order (ORDER BY id ASC FOR UPDATE)
        before modifying any rows. Commits approval (if needed), hero flag updates, sibling
        clearing, and audit fields atomically in one single transaction.
        """
        target = session.scalar(
            select(CourseImage).where(
                CourseImage.id == image_id,
                CourseImage.source_type == CourseImageSource.USER,
            )
        )
        if target is None:
            return None

        tier_images = list(session.scalars(
            select(CourseImage).where(
                CourseImage.course_id == target.course_id,
                CourseImage.source_type == CourseImageSource.USER,
            ).order_by(CourseImage.id.asc()).with_for_update()
            .execution_options(populate_existing=True)
        ).all())

        image = next((img for img in tier_images if img.id == image_id), None)
        if image is None:
            session.rollback()
            return None

        now = datetime.now(timezone.utc)
        if featured:
            for sibling in tier_images:
                if sibling.id != image.id:
                    sibling.is_hero = False
            image.is_hero = True
            image.moderation_status = CourseImageModeration.APPROVED
            image.moderated_by_user_id = moderator_user_id
            image.moderated_at = now
            image.moderation_reason = None
            image.moderation_action = CourseImageModerationAction.FEATURED
        else:
            image.is_hero = False
            image.moderated_by_user_id = moderator_user_id
            image.moderated_at = now
            image.moderation_reason = None
            image.moderation_action = CourseImageModerationAction.UNFEATURED

        session.commit()
        session.refresh(image)
        return image

    def set_featured(self, session: Session, image: CourseImage, featured: bool) -> CourseImage:
        """Sets or clears the explicit hero pick within this photo's source tier.
        Deterministic locking in ascending id order ensures Postgres concurrency safety.
        """
        tier_images = list(session.scalars(
            select(CourseImage).where(
                CourseImage.course_id == image.course_id,
                CourseImage.source_type == image.source_type,
            ).order_by(CourseImage.id.asc()).with_for_update()
            .execution_options(populate_existing=True)
        ).all())
        target = next((img for img in tier_images if img.id == image.id), image)
        if featured:
            for sibling in tier_images:
                if sibling.id != target.id:
                    sibling.is_hero = False
        target.is_hero = featured
        session.commit()
        session.refresh(target)
        return target

    def claim_for_scoring(
        self, session: Session, image_id: int, *, max_attempts: int, lease_seconds: int = 300,
    ) -> CourseImage | None:
        """Atomically claims a photo for scoring in a short transaction.

        Returns the claimed CourseImage with its scoring_claimed_at timestamp, or None
        if the photo cannot be claimed (not user-sourced, not pending, already scored,
        max attempts exceeded, course hero locked, or another claim is currently active).
        Does NOT hold a database row lock or transaction across outbound network calls.
        """
        image = session.scalar(
            select(CourseImage).where(
                CourseImage.id == image_id,
                CourseImage.source_type == CourseImageSource.USER,
            ).with_for_update()
            .execution_options(populate_existing=True)
        )
        if image is None:
            return None
        session.refresh(image)
        if image.moderation_status != CourseImageModeration.PENDING:
            session.rollback()
            return None
        if image.scored_at is not None:
            session.rollback()
            return None
        if (image.scoring_attempts or 0) >= max_attempts:
            session.rollback()
            return None
        if self.has_featured_hero(session, image.course_id):
            session.rollback()
            return None

        now = datetime.now(timezone.utc)
        if image.scoring_claimed_at is not None:
            claimed_at = (
                image.scoring_claimed_at
                if image.scoring_claimed_at.tzinfo
                else image.scoring_claimed_at.replace(tzinfo=timezone.utc)
            )
            if (now - claimed_at).total_seconds() < lease_seconds:
                session.rollback()
                return None

        image.scoring_attempts = (image.scoring_attempts or 0) + 1
        image.scoring_claimed_at = now
        session.commit()
        session.refresh(image)
        return image

    def complete_scoring(
        self,
        session: Session,
        image_id: int,
        *,
        claim_timestamp: datetime,
        score: int,
        reasons: list[str],
        auto_approve_score: float,
    ) -> bool:
        """Conditionally persists scoring output and auto-approves only if the photo
        still belongs to this claimed scoring attempt and human moderation has not
        intervened.

        Human moderation always takes precedence: if an admin approved, rejected, or
        featured the photo while scoring was in flight, scoring results are not persisted
        and auto-approval is skipped.
        """
        image = session.scalar(
            select(CourseImage)
            .where(
                CourseImage.id == image_id,
                CourseImage.source_type == CourseImageSource.USER,
            )
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if image is None:
            return False

        session.refresh(image)

        # Verify claim ownership
        if image.scoring_claimed_at != claim_timestamp:
            session.rollback()
            return False

        # Check eligibility and precedence: if human moderated or hero locked
        if image.moderation_status != CourseImageModeration.PENDING or self.has_featured_hero(session, image.course_id):
            image.scoring_claimed_at = None
            session.commit()
            return False

        now = datetime.now(timezone.utc)
        image.quality_score = float(score)
        image.quality_score_reasons = reasons
        image.scored_at = now
        image.scoring_claimed_at = None

        if score >= auto_approve_score:
            image.moderation_status = CourseImageModeration.APPROVED
            image.moderated_by_user_id = None
            image.moderated_at = now
            image.moderation_reason = "auto:gemini"
            image.moderation_action = CourseImageModerationAction.AUTO_APPROVED

        session.commit()
        session.refresh(image)
        return True

    def release_score_claim(
        self, session: Session, image_id: int, *, claim_timestamp: datetime,
    ) -> None:
        """Releases an in-flight scoring claim on transient failure so the sweeper
        or retry can claim it again later."""
        image = session.scalar(
            select(CourseImage)
            .where(
                CourseImage.id == image_id,
                CourseImage.source_type == CourseImageSource.USER,
            )
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if image is not None and image.scoring_claimed_at == claim_timestamp:
            image.scoring_claimed_at = None
            session.commit()
        else:
            session.rollback()

    def record_permanent_score_failure(
        self, session: Session, image_id: int, *, claim_timestamp: datetime,
    ) -> None:
        """Records a permanent scoring failure (provider refusal/400), setting scored_at
        and clearing claim so it won't be retried."""
        image = session.scalar(
            select(CourseImage)
            .where(
                CourseImage.id == image_id,
                CourseImage.source_type == CourseImageSource.USER,
            )
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if image is not None and image.scoring_claimed_at == claim_timestamp:
            image.scored_at = datetime.now(timezone.utc)
            image.scoring_claimed_at = None
            image.quality_score = None
            session.commit()
        else:
            session.rollback()

    def record_score(
        self, session: Session, image: CourseImage, *, score: float, reasons: list[str],
    ) -> CourseImage:
        image.quality_score = score
        image.quality_score_reasons = reasons
        image.scored_at = datetime.now(timezone.utc)
        image.scoring_claimed_at = None
        image.scoring_attempts = (image.scoring_attempts or 0) + 1
        session.commit()
        session.refresh(image)
        return image

    def record_score_failure(
        self, session: Session, image: CourseImage, *, permanent: bool = False,
    ) -> CourseImage:
        """Counts a failed scoring attempt."""
        image.scoring_attempts = (image.scoring_attempts or 0) + 1
        image.scoring_claimed_at = None
        if permanent:
            image.scored_at = datetime.now(timezone.utc)
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
