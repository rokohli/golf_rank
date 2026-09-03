from datetime import datetime, timezone
import hashlib
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import exists, select, text, tuple_
from sqlalchemy.orm import Session, object_session

from .core.auth import CurrentUser
from .course_images.repository import _rank_key
from .models import Course, CourseImage, CourseImageModeration, CourseReconciliation, DeletedIdentity, User


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
    session = object_session(course)
    image_base_url = session.info.get("course_image_base_url") if session is not None else None

    images = getattr(course, "images", None) or []
    approved_with_url: list[tuple[CourseImage, str]] = []
    for image in images:
        if image.moderation_status != CourseImageModeration.APPROVED:
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

    wikimedias = [pair for pair in approved_with_url if (pair[0].source_type or "").lower() == "wikimedia"]
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


def course_image_data(course: Course) -> list[dict]:
    session = object_session(course)
    image_base_url = session.info.get("course_image_base_url") if session is not None else None
    output = []
    for image in course.images:
        if image.moderation_status != CourseImageModeration.APPROVED:
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
        })
    return output


def storage_image_url(base_url: str | None, storage_key: str | None) -> str | None:
    if not base_url or not storage_key:
        return None
    return f"{base_url.rstrip('/')}/{quote(storage_key, safe='/')}"
