from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_course, require_user, stored_user
from .models import ActivityEvent, Course, SavedCourse, SavedList
from .schemas import CourseOut


router = APIRouter(prefix="/api/v1/me/saved-lists", tags=["saves"])
Visibility = Literal["private", "friends", "public"]


class SavedListIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    visibility: Visibility = "private"
    is_default: bool = False


class SavedListPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    visibility: Visibility | None = None
    is_default: bool | None = None


class SavedCourseIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class SavedCourseOut(BaseModel):
    id: int
    course: CourseOut
    note: str | None
    created_at: datetime


class SavedListOut(BaseModel):
    id: int
    name: str
    visibility: Visibility
    is_default: bool
    courses: list[SavedCourseOut]
    created_at: datetime


def _require_list(session: Session, user_id: int, list_id: int) -> SavedList:
    saved_list = session.scalar(
        select(SavedList).where(SavedList.id == list_id, SavedList.user_id == user_id)
    )
    if saved_list is None:
        raise HTTPException(404, "Saved list not found")
    return saved_list


def _list_out(session: Session, saved_list: SavedList) -> SavedListOut:
    saved_courses = session.scalars(
        select(SavedCourse)
        .where(SavedCourse.list_id == saved_list.id)
        .order_by(SavedCourse.created_at.desc(), SavedCourse.id.desc())
    ).all()
    output_courses: list[SavedCourseOut] = []
    for saved in saved_courses:
        try:
            course = require_course(session, saved.course_id)
        except HTTPException:
            course = None
        if course is not None:
            output_courses.append(
                SavedCourseOut(
                    id=saved.id,
                    course=course_data(course),
                    note=saved.note,
                    created_at=saved.created_at,
                )
            )
    return SavedListOut(
        id=saved_list.id,
        name=saved_list.name,
        visibility=saved_list.visibility,
        is_default=saved_list.is_default,
        courses=output_courses,
        created_at=saved_list.created_at,
    )


def _make_default(session: Session, user_id: int, list_id: int) -> None:
    session.execute(
        update(SavedList)
        .where(SavedList.user_id == user_id, SavedList.id != list_id)
        .values(is_default=False)
    )


@router.post("", response_model=SavedListOut, status_code=201)
def create_saved_list(
    payload: SavedListIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> SavedListOut:
    user = require_user(session, current, create=True)
    has_lists = session.scalar(
        select(SavedList.id).where(SavedList.user_id == user.id).limit(1)
    ) is not None
    saved_list = SavedList(
        user_id=user.id,
        name=payload.name.strip(),
        visibility=payload.visibility,
        is_default=payload.is_default or not has_lists,
    )
    session.add(saved_list)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "A saved list with this name already exists") from exc
    if saved_list.is_default:
        _make_default(session, user.id, saved_list.id)
    session.commit()
    return _list_out(session, saved_list)


@router.get("", response_model=list[SavedListOut])
def list_saved_lists(
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[SavedListOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    lists = session.scalars(
        select(SavedList)
        .where(SavedList.user_id == user.id)
        .order_by(SavedList.is_default.desc(), SavedList.created_at.desc())
    ).all()
    return [_list_out(session, saved_list) for saved_list in lists]


@router.patch("/{list_id}", response_model=SavedListOut)
def update_saved_list(
    list_id: int,
    payload: SavedListPatch,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> SavedListOut:
    user = require_user(session, current)
    saved_list = _require_list(session, user.id, list_id)
    if payload.name is not None:
        saved_list.name = payload.name.strip()
    if payload.visibility is not None:
        saved_list.visibility = payload.visibility
        session.execute(
            update(ActivityEvent)
            .where(
                ActivityEvent.actor_user_id == user.id,
                ActivityEvent.subject_type == "saved_course",
                ActivityEvent.event_data["list_id"].as_integer() == saved_list.id,
            )
            .values(visibility=payload.visibility)
        )
    if payload.is_default is True:
        saved_list.is_default = True
        _make_default(session, user.id, saved_list.id)
    elif payload.is_default is False and saved_list.is_default:
        raise HTTPException(422, "Choose another default list before unsetting this one")
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "A saved list with this name already exists") from exc
    return _list_out(session, saved_list)


@router.delete("/{list_id}", status_code=204)
def delete_saved_list(
    list_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    saved_list = _require_list(session, user.id, list_id)
    was_default = saved_list.is_default
    session.execute(
        delete(ActivityEvent).where(
            ActivityEvent.actor_user_id == user.id,
            ActivityEvent.subject_type == "saved_course",
            ActivityEvent.event_data["list_id"].as_integer() == saved_list.id,
        )
    )
    session.delete(saved_list)
    session.flush()
    if was_default:
        next_list = session.scalar(
            select(SavedList)
            .where(SavedList.user_id == user.id)
            .order_by(SavedList.created_at.asc())
            .limit(1)
        )
        if next_list is not None:
            next_list.is_default = True
    session.commit()
    return Response(status_code=204)


@router.put("/{list_id}/courses/{course_id}", response_model=SavedListOut)
def save_course(
    list_id: int,
    course_id: int,
    payload: SavedCourseIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> SavedListOut:
    user = require_user(session, current)
    saved_list = _require_list(session, user.id, list_id)
    course_id = require_course(session, course_id).id
    saved = session.scalar(
        select(SavedCourse).where(
            SavedCourse.list_id == saved_list.id, SavedCourse.course_id == course_id
        )
    )
    created = saved is None
    if saved is None:
        saved = SavedCourse(list_id=saved_list.id, course_id=course_id)
    saved.note = payload.note
    session.add(saved)
    session.flush()
    if created:
        session.add(
            ActivityEvent(
                actor_user_id=user.id,
                event_type="course_saved",
                subject_type="saved_course",
                subject_id=saved.id,
                visibility=saved_list.visibility,
                event_data={"list_id": saved_list.id, "course_id": course_id},
            )
        )
    session.commit()
    return _list_out(session, saved_list)


@router.delete("/{list_id}/courses/{course_id}", status_code=204)
def remove_saved_course(
    list_id: int,
    course_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    saved_list = _require_list(session, user.id, list_id)
    course_id = require_course(session, course_id).id
    saved = session.scalar(
        select(SavedCourse).where(
            SavedCourse.list_id == saved_list.id, SavedCourse.course_id == course_id
        )
    )
    if saved is None:
        raise HTTPException(404, "Saved course not found")
    session.execute(
        delete(ActivityEvent).where(
            ActivityEvent.actor_user_id == user.id,
            ActivityEvent.subject_type == "saved_course",
            ActivityEvent.subject_id == saved.id,
        )
    )
    session.delete(saved)
    session.commit()
    return Response(status_code=204)
