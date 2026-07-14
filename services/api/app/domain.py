from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser
from .models import Course, User


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
    return course


def course_data(course: Course) -> dict:
    return {
        "id": course.id,
        "name": course.name,
        "region": course.region,
        "green_fee": course.green_fee,
        "difficulty": course.difficulty,
        "is_public": course.is_public,
    }
