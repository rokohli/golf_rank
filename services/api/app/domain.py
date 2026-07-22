from fastapi import HTTPException
from sqlalchemy import exists, select, tuple_
from sqlalchemy.orm import Session

from .core.auth import CurrentUser
from .models import Course, CourseReconciliation, User


def stored_user(session: Session, current: CurrentUser, *, create: bool = False) -> User | None:
    user = session.scalar(select(User).where(User.provider_subject == current.provider_subject))
    if user is None and create:
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
        "images": [
            {
                "id": image.id,
                "url": image.external_url,
                "alt_text": image.alt_text,
                "source_name": image.source_name,
                "source_url": image.source_url,
                "position": image.position,
                "is_hero": image.is_hero,
            }
            for image in course.images
            if image.external_url is not None
        ],
    }
