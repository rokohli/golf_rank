from datetime import datetime, timezone
import hashlib
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import exists, select, text, tuple_
from sqlalchemy.orm import Session, object_session

from .core.auth import CurrentUser
from .course_images.repository import _rank_key
from .models import (
    Course,
    CourseImage,
    CourseImageModeration,
    CourseImageSource,
    CourseReconciliation,
    DeletedIdentity,
    FailedObjectDeletion,
    Profile,
    Round,
    User,
    UserBlock,
    UserMute,
)


def lock_identity_transaction(session: Session, provider_subject: str) -> None:
    """Serialize account creation/deletion for one identity in production.

    Row locks cannot protect the no-user case. A transaction-scoped advisory
    lock closes that race without retaining the subject outside the database
    session or locking unrelated accounts.
    """
    if session.get_bind().dialect.name != "postgresql":
        return
    lock_id = int.from_bytes(
        hashlib.sha256(provider_subject.encode()).digest()[:8], byteorder="big", signed=True
    )
    session.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": lock_id})


def stored_user(session: Session, current: CurrentUser, *, create: bool = False) -> User | None:
    if create:
        lock_identity_transaction(session, current.provider_subject)
    user = session.scalar(select(User).where(User.provider_subject == current.provider_subject))
    if user is None and create:
        if session.get(DeletedIdentity, current.provider_subject) is not None:
            raise HTTPException(410, "Account has been deleted")
        user = User(provider_subject=current.provider_subject)
        session.add(user)
        session.flush()
    return user


def require_user(session: Session, current: CurrentUser, *, create: bool = False) -> User:
    user = stored_user(session, current, create=create)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


def blocked_ids(session: Session, user_id: int) -> set[int]:
    """A block is mutual for audience purposes: either direction excludes."""
    outgoing = session.scalars(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user_id)).all()
    incoming = session.scalars(select(UserBlock.blocker_id).where(UserBlock.blocked_id == user_id)).all()
    return set(outgoing) | set(incoming)


def muted_ids(session: Session, user_id: int) -> set[int]:
    """Mute is reciprocal for audience selection: neither direction is social consent."""
    outgoing = session.scalars(select(UserMute.muted_id).where(UserMute.muter_id == user_id)).all()
    incoming = session.scalars(select(UserMute.muter_id).where(UserMute.muted_id == user_id)).all()
    return set(outgoing) | set(incoming)


def require_course(session: Session, course_id: int) -> Course:
    course = session.get(Course, course_id)
    if course is None:
        raise HTTPException(404, "Course not found")
    if course.source_course_id is None:
        return course
    canonical_id = session.scalar(
        select(CourseReconciliation.canonical_course_id).where(
            CourseReconciliation.source == course.source,
            CourseReconciliation.source_course_id == course.source_course_id,
            CourseReconciliation.match_status == "confirmed",
        )
    )
    if canonical_id is None or canonical_id == course.id:
        return course
    canonical = session.get(Course, canonical_id)
    if canonical is None:
        raise HTTPException(404, "Course not found")
    return canonical


def require_courses(session: Session, course_ids) -> dict[int, Course]:
    """Batched require_course: canonicalizes many course ids in a fixed
    number of queries instead of up to two per id. A course search/profile
    page can carry up to 100+ course ids (e.g. get_user_courses's per-state
    resolution before pagination) -- one require_course call per id there
    makes even a limit=1 request touch every played course. An id that
    doesn't resolve to an existing course is simply omitted, matching
    require_course's 404 by absence rather than by raising per id."""
    course_ids = set(course_ids)
    if not course_ids:
        return {}
    courses = {course.id: course for course in session.scalars(select(Course).where(Course.id.in_(course_ids))).all()}
    needing_lookup = [course for course in courses.values() if course.source_course_id is not None]
    canonical_id_by_course_id: dict[int, int] = {}
    if needing_lookup:
        keys = {(course.source, course.source_course_id) for course in needing_lookup}
        recon_rows = session.execute(
            select(
                CourseReconciliation.source,
                CourseReconciliation.source_course_id,
                CourseReconciliation.canonical_course_id,
            ).where(
                tuple_(CourseReconciliation.source, CourseReconciliation.source_course_id).in_(keys),
                CourseReconciliation.match_status == "confirmed",
            )
        ).all()
        recon_map = {(source, source_course_id): canonical_id for source, source_course_id, canonical_id in recon_rows}
        for course in needing_lookup:
            canonical_id = recon_map.get((course.source, course.source_course_id))
            if canonical_id is not None and canonical_id != course.id:
                canonical_id_by_course_id[course.id] = canonical_id
        missing_canonical_ids = {
            canonical_id for canonical_id in canonical_id_by_course_id.values() if canonical_id not in courses
        }
        if missing_canonical_ids:
            for extra in session.scalars(select(Course).where(Course.id.in_(missing_canonical_ids))).all():
                courses[extra.id] = extra
    result: dict[int, Course] = {}
    for course_id in course_ids:
        course = courses.get(course_id)
        if course is None:
            continue
        canonical_id = canonical_id_by_course_id.get(course_id)
        canonical = courses.get(canonical_id) if canonical_id is not None else None
        result[course_id] = canonical if canonical is not None else course
    return result


def canonical_courses_only():
    """SQL predicate that hides source rows mapped to another canonical course."""

    return ~exists(
        select(CourseReconciliation.id).where(
            CourseReconciliation.source == Course.source,
            CourseReconciliation.source_course_id == Course.source_course_id,
            CourseReconciliation.match_status == "confirmed",
            CourseReconciliation.canonical_course_id != Course.id,
        )
    )


def course_identity_ids(session: Session, course: Course) -> set[int]:
    """Return the canonical ID and every confirmed source alias for read aggregation."""

    alias_identities = session.execute(
        select(CourseReconciliation.source, CourseReconciliation.source_course_id).where(
            CourseReconciliation.canonical_course_id == course.id,
            CourseReconciliation.match_status == "confirmed",
        )
    ).all()
    if not alias_identities:
        return {course.id}
    aliases = set(session.scalars(select(Course.id).where(
        tuple_(Course.source, Course.source_course_id).in_(alias_identities)
    )).all())
    return {course.id, *aliases}


def course_identity_ids_bulk(session: Session, courses) -> dict[int, set[int]]:
    """Batched course_identity_ids: resolves aliases for many canonical
    courses in two queries total instead of two per course. A courses-played
    page can carry up to 100 canonical courses -- calling course_identity_ids
    once per course there would double that page's query count."""
    courses = list(courses)
    result: dict[int, set[int]] = {course.id: {course.id} for course in courses}
    if not courses:
        return result
    canonical_ids = set(result)
    alias_identities = session.execute(
        select(
            CourseReconciliation.canonical_course_id,
            CourseReconciliation.source,
            CourseReconciliation.source_course_id,
        ).where(
            CourseReconciliation.canonical_course_id.in_(canonical_ids),
            CourseReconciliation.match_status == "confirmed",
        )
    ).all()
    if not alias_identities:
        return result
    keys = {(source, source_course_id) for _, source, source_course_id in alias_identities}
    alias_id_by_key = {
        (source, source_course_id): course_id
        for course_id, source, source_course_id in session.execute(
            select(Course.id, Course.source, Course.source_course_id).where(
                tuple_(Course.source, Course.source_course_id).in_(keys)
            )
        ).all()
    }
    for canonical_id, source, source_course_id in alias_identities:
        alias_id = alias_id_by_key.get((source, source_course_id))
        if alias_id is not None:
            result[canonical_id].add(alias_id)
    return result


def is_wikimedia_negative_cached(course: Course) -> bool:
    negative_caches = getattr(course, "negative_caches", None)
    if negative_caches is not None:
        now = datetime.now(timezone.utc)
        for row in negative_caches:
            if row.provider == "wikimedia":
                expires_at = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
                if expires_at > now:
                    return True
        return False
    session = object_session(course)
    if session is not None:
        from .course_images.repository import CourseImageRepository
        return CourseImageRepository().get_negative_cache(session, course.id, "wikimedia") is not None
    return False


DEFAULT_WIKIMEDIA_CACHE_POSITIVE_TTL_SECONDS = 30 * 24 * 3600


def is_wikimedia_stale(image: CourseImage, positive_ttl_seconds: int = DEFAULT_WIKIMEDIA_CACHE_POSITIVE_TTL_SECONDS) -> bool:
    """Shared staleness check for a cached Wikimedia row -- used by both the
    card-hero fallback below and CourseImageService's detail-hero resolver
    (course_images/service.py) so the two paths can't silently drift apart."""
    if image.created_at is None:
        return False
    created_at = image.created_at if image.created_at.tzinfo else image.created_at.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(timezone.utc) - created_at).total_seconds()
    return age_seconds >= positive_ttl_seconds


def _hero_dict(hero_type: str, image: CourseImage, url: str, course_name: str) -> dict:
    return {
        "type": hero_type,
        "url": url,
        "thumbnail_url": image.thumbnail_url or url,
        "attribution": image.source_name,
        "license": image.license_name,
        "license_url": image.license_url,
        "source_url": image.source_url,
        "alt_text": image.alt_text or f"{course_name} course photo",
        "width": image.width,
        "height": image.height,
    }


def course_card_hero_data(course: Course) -> dict:
    """Cheap, read-only mirror of CourseImageService.resolve_hero_image()'s
    OFFICIAL/USER/WIKIMEDIA ordering for list/search payloads, which are
    rendered from already-loaded rows and can't afford one Wikimedia lookup +
    lock per card. Any change to that priority order must be mirrored here."""
    session = object_session(course)
    image_base_url = session.info.get("course_image_base_url") if session is not None else None
    positive_ttl = (
        session.info.get("wikimedia_cache_positive_ttl_seconds", DEFAULT_WIKIMEDIA_CACHE_POSITIVE_TTL_SECONDS)
        if session is not None
        else DEFAULT_WIKIMEDIA_CACHE_POSITIVE_TTL_SECONDS
    )

    images = getattr(course, "images", None) or []
    round_visibility = _batch_round_visibility(
        session,
        {image.round_id for image in images if image.round_id is not None},
    )
    approved_with_url: list[tuple[CourseImage, str]] = []
    for image in images:
        if image.moderation_status != CourseImageModeration.APPROVED:
            continue
        if image.round_id is not None and round_visibility.get(image.round_id) != "public":
            continue
        url = image.external_url or storage_image_url(image_base_url, image.storage_key)
        if not url:
            continue
        approved_with_url.append((image, url))

    officials = [pair for pair in approved_with_url if (pair[0].source_type or "").lower() == "official"]
    if officials:
        best_img, best_url = min(officials, key=lambda pair: _rank_key(pair[0]))
        return _hero_dict("OFFICIAL", best_img, best_url, course.name)

    users = [pair for pair in approved_with_url if (pair[0].source_type or "").lower() == "user"]
    if users:
        best_img, best_url = min(users, key=lambda pair: _rank_key(pair[0]))
        return _hero_dict("USER", best_img, best_url, course.name)

    wikimedias = [
        pair for pair in approved_with_url
        if (pair[0].source_type or "").lower() == "wikimedia"
        and not is_wikimedia_stale(pair[0], positive_ttl)
    ]
    if wikimedias and not is_wikimedia_negative_cached(course):
        best_img, best_url = min(wikimedias, key=lambda pair: _rank_key(pair[0]))
        return _hero_dict("WIKIMEDIA", best_img, best_url, course.name)

    return {
        "type": "NONE",
        "url": None,
        "thumbnail_url": None,
        "attribution": None,
        "license": None,
        "license_url": None,
        "source_url": None,
        "alt_text": f"{course.name} course photo",
        "width": None,
        "height": None,
    }


def course_data(course: Course) -> dict:
    return {
        "id": course.id,
        "name": course.name,
        "region": course.region,
        "green_fee": course.green_fee,
        "difficulty": course.difficulty,
        "is_public": course.is_public,
        "latitude": course.latitude,
        "longitude": course.longitude,
        "source": course.source,
        "country_code": course.country_code,
        "admin1_code": course.admin1_code,
        "admin1_name": course.admin1_name,
        "city": course.city,
        "facility_name": course.facility_name,
        "course_name": course.course_name,
        "status": course.status,
        "hole_count": course.hole_count,
        "par": course.par,
        "slope_rating": course.slope_rating,
        "tee_time_url": course.tee_time_url,
        "access": course.access,
        "images": course_image_data(course),
        "hero_image": course_card_hero_data(course),
    }


def uploader_username(session: Session | None, uploaded_by_user_id: int | None) -> str | None:
    if session is None or uploaded_by_user_id is None:
        return None
    profile = session.get(Profile, uploaded_by_user_id)
    return profile.username if profile else None


def _batch_uploader_usernames(session: Session | None, user_ids: set[int]) -> dict[int, str | None]:
    """One query for every distinct uploader instead of one per image -- a
    course/round photo list can have many images from many different
    uploaders, and uploader_username()'s per-call session.get() would
    otherwise add an N+1 series of profile lookups on top of the
    course/image load itself."""
    if session is None or not user_ids:
        return {}
    rows = session.execute(
        select(Profile.user_id, Profile.username).where(Profile.user_id.in_(user_ids))
    ).all()
    return {user_id: username for user_id, username in rows}


batch_uploader_usernames = _batch_uploader_usernames


def preload_round_visibility(session: Session, courses) -> None:
    """Warm the round-visibility cache for a whole page of courses in one
    query. Each course's images normally carry a disjoint set of round ids,
    so without this, course_card_hero_data/course_image_data calling
    _batch_round_visibility per course still issues one query per card --
    call this once, before serializing a list/search page, with every course
    on the page."""
    round_ids = {
        image.round_id
        for course in courses
        for image in (getattr(course, "images", None) or [])
        if image.round_id is not None
    }
    _batch_round_visibility(session, round_ids)


def _batch_round_visibility(session: Session | None, round_ids: set[int]) -> dict[int, str]:
    """Round.visibility by id, memoized on the session for the life of the
    request. course_card_hero_data and course_image_data each call this once
    per course, and a course list/search page serializes up to 100 courses --
    without the cache that's up to 200 round-visibility queries per page.
    Caching on session.info (already used for course_image_base_url etc.)
    means only round ids not seen yet on this request hit the database,
    regardless of how many cards or call sites ask for them."""
    if session is None or not round_ids:
        return {}
    cache: dict[int, str] = session.info.setdefault("round_visibility_cache", {})
    missing = round_ids - cache.keys()
    if missing:
        cache.update(session.execute(select(Round.id, Round.visibility).where(Round.id.in_(missing))).all())
    return {round_id: cache[round_id] for round_id in round_ids if round_id in cache}


def course_image_data(course: Course) -> list[dict]:
    """All of a course's photos, regardless of moderation_status -- moderation
    only gates hero-image eligibility (see CourseImageRepository.approved_images,
    used independently by CourseImageService.resolve_hero_image), never whether
    a photo appears in the course's own gallery. Wikimedia is excluded here: it
    only ever serves as a hero-image fallback (CourseImageService._resolve),
    never as a gallery photo.

    This gallery has no per-viewer context (it backs the unauthenticated course
    detail endpoint too), so a round-linked photo can only be included once its
    round is "public" -- private and friends-only rounds never contribute a
    photo here, regardless of who is asking."""
    session = object_session(course)
    image_base_url = session.info.get("course_image_base_url") if session is not None else None
    usernames = _batch_uploader_usernames(
        session,
        {image.uploaded_by_user_id for image in course.images if image.uploaded_by_user_id is not None},
    )
    round_visibility = _batch_round_visibility(
        session,
        {image.round_id for image in course.images if image.round_id is not None},
    )
    output = []
    for image in course.images:
        if (image.source_type or "").lower() == CourseImageSource.WIKIMEDIA:
            continue
        if image.round_id is not None and round_visibility.get(image.round_id) != "public":
            continue
        url = image.external_url or storage_image_url(image_base_url, image.storage_key)
        if url is None:
            continue
        output.append({
            "id": image.id,
            "url": url,
            "alt_text": image.alt_text,
            "source_name": image.source_name,
            "source_url": image.source_url,
            "license_name": image.license_name,
            "license_url": image.license_url,
            "position": image.position,
            "is_hero": image.is_hero,
            "source_type": image.source_type,
            "quality_score": image.quality_score,
            "width": image.width,
            "height": image.height,
            "created_at": image.created_at.isoformat() if image.created_at else None,
            "uploaded_by_username": usernames.get(image.uploaded_by_user_id) if image.uploaded_by_user_id is not None else None,
        })
    return output


def delete_permanent_objects(session: Session, storage, storage_keys, *, context: str) -> None:
    """Deletes each already-promoted (non-pending-prefixed) storage_key via
    storage, durably recording a FailedObjectDeletion row for any that
    fails. Only for permanent keys: a pending-prefixed one has the R2
    lifecycle rule as a backstop and doesn't need this, but a permanent
    object has no other recovery path once its CourseImage row is gone --
    silently dropping a delete_object failure here would leave it publicly
    reachable forever. Runs its own commit, separate from whatever
    transaction already deleted the owning round/account.

    storage may be None (object storage unconfigured, e.g. an R2 credential
    or COURSE_IMAGE_BASE_URL regression) -- every key is then recorded for
    retry directly, with no attempted deletion, rather than silently
    dropped just because no client could be constructed right now."""
    failed = False
    for storage_key in storage_keys:
        if storage is None or not storage.delete_object(storage_key):
            session.add(FailedObjectDeletion(storage_key=storage_key, context=context))
            failed = True
    if failed:
        session.commit()


def storage_image_url(base_url: str | None, storage_key: str | None) -> str | None:
    if not base_url or not storage_key:
        return None
    return f"{base_url.rstrip('/')}/{quote(storage_key, safe='/')}"


def _round_image_dict(image: CourseImage, image_base_url: str | None, usernames: dict[int, str | None]) -> dict | None:
    url = image.external_url or storage_image_url(image_base_url, image.storage_key)
    if url is None:
        return None
    return {
        "id": image.id,
        "url": url,
        "alt_text": image.alt_text,
        "source_name": image.source_name,
        "source_url": image.source_url,
        "license_name": image.license_name,
        "license_url": image.license_url,
        "position": image.position,
        "is_hero": image.is_hero,
        "source_type": image.source_type,
        "quality_score": image.quality_score,
        "width": image.width,
        "height": image.height,
        "created_at": image.created_at.isoformat() if image.created_at else None,
        "uploaded_by_username": usernames.get(image.uploaded_by_user_id) if image.uploaded_by_user_id is not None else None,
        "round_id": image.round_id,
    }


def round_image_data(session: Session, round_id: int) -> list[dict]:
    """Photos submitted with a specific round, regardless of moderation_status --
    moderation only gates hero-image/course-gallery eligibility (course_image_data
    above), never a user's own round posting."""
    return round_image_data_bulk(session, {round_id}).get(round_id, [])


def round_image_data_bulk(session: Session, round_ids: set[int]) -> dict[int, list[dict]]:
    """Same as round_image_data, but for many rounds in one pass -- e.g. one
    feed page covering many round-backed events. One CourseImage query for
    every round_id and one profile query for every distinct uploader across
    all of them, instead of round_image_data's own pair of queries repeated
    once per round: the feed serialization loop previously called
    round_image_data() once per event, adding an N+1 series of CourseImage
    (and, for rounds with photos, profile) queries on top of the event page
    load itself."""
    if not round_ids:
        return {}
    image_base_url = session.info.get("course_image_base_url")
    images = session.scalars(
        select(CourseImage).where(CourseImage.round_id.in_(round_ids)).order_by(CourseImage.round_id, CourseImage.position)
    ).all()
    usernames = _batch_uploader_usernames(
        session, {image.uploaded_by_user_id for image in images if image.uploaded_by_user_id is not None}
    )
    grouped: dict[int, list[dict]] = {round_id: [] for round_id in round_ids}
    for image in images:
        entry = _round_image_dict(image, image_base_url, usernames)
        if entry is not None:
            grouped[image.round_id].append(entry)
    return grouped
