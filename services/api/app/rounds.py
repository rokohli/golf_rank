from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_course, require_user, stored_user
from .models import (
    ActivityEvent,
    Course,
    Round,
    RoundNote,
    UserCourseRating,
    UserCourseState,
)
from .schemas import CourseOut


router = APIRouter(prefix="/api/v1/me/rounds", tags=["rounds"])
course_state_router = APIRouter(prefix="/api/v1/me/course-states", tags=["rounds"])
Visibility = Literal["private", "friends", "public"]


class RoundIn(BaseModel):
    course_id: int = Field(gt=0)
    played_on: date
    score: int | None = Field(default=None, ge=40, le=250)
    note: str | None = Field(default=None, max_length=5000)
    visibility: Visibility = "friends"

    @field_validator("played_on")
    @classmethod
    def played_round_cannot_be_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("played_on cannot be in the future")
        return value


class RoundPatch(BaseModel):
    played_on: date | None = None
    score: int | None = Field(default=None, ge=40, le=250)
    note: str | None = Field(default=None, max_length=5000)
    visibility: Visibility | None = None

    @field_validator("played_on")
    @classmethod
    def played_round_cannot_be_in_future(cls, value: date | None) -> date | None:
        if value is not None and value > date.today():
            raise ValueError("played_on cannot be in the future")
        return value


class RoundOut(BaseModel):
    id: int
    course: CourseOut
    played_on: date
    score: int | None
    note: str | None
    visibility: Visibility
    created_at: datetime
    updated_at: datetime


class CourseStateOut(BaseModel):
    course: CourseOut
    has_played: bool
    round_count: int
    last_played_on: date | None


def _round_out(session: Session, round_: Round) -> RoundOut:
    course = session.get(Course, round_.course_id)
    note = session.get(RoundNote, round_.id)
    assert course is not None
    return RoundOut(
        id=round_.id,
        course=course_data(course),
        played_on=round_.played_on,
        score=round_.score,
        note=note.body if note else None,
        visibility=round_.visibility,
        created_at=round_.created_at,
        updated_at=round_.updated_at,
    )


def _refresh_course_state(session: Session, user_id: int, course_id: int) -> None:
    count, last_played = session.execute(
        select(func.count(Round.id), func.max(Round.played_on)).where(
            Round.user_id == user_id, Round.course_id == course_id
        )
    ).one()
    state = session.scalar(
        select(UserCourseState).where(
            UserCourseState.user_id == user_id,
            UserCourseState.course_id == course_id,
        )
    )
    if state is None:
        state = UserCourseState(user_id=user_id, course_id=course_id)
    state.round_count = count
    state.has_played = count > 0
    state.last_played_on = last_played
    session.add(state)


def _event_data(round_: Round) -> dict:
    return {
        "course_id": round_.course_id,
        "played_on": round_.played_on.isoformat(),
        "score": round_.score,
    }


@router.post("", response_model=RoundOut, status_code=201)
def create_round(
    payload: RoundIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RoundOut:
    user = require_user(session, current, create=True)
    require_course(session, payload.course_id)
    round_ = Round(
        user_id=user.id,
        course_id=payload.course_id,
        played_on=payload.played_on,
        score=payload.score,
        visibility=payload.visibility,
    )
    session.add(round_)
    session.flush()
    if payload.note:
        session.add(RoundNote(round_id=round_.id, body=payload.note))
    _refresh_course_state(session, user.id, payload.course_id)
    session.add(
        ActivityEvent(
            actor_user_id=user.id,
            event_type="round_logged",
            subject_type="round",
            subject_id=round_.id,
            visibility=round_.visibility,
            event_data=_event_data(round_),
        )
    )
    session.commit()
    return _round_out(session, round_)


@router.get("", response_model=list[RoundOut])
def list_rounds(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[RoundOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    rounds = session.scalars(
        select(Round)
        .where(Round.user_id == user.id)
        .order_by(Round.played_on.desc(), Round.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [_round_out(session, item) for item in rounds]


@router.get("/{round_id}", response_model=RoundOut)
def get_round(
    round_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RoundOut:
    user = require_user(session, current)
    round_ = session.scalar(
        select(Round).where(Round.id == round_id, Round.user_id == user.id)
    )
    if round_ is None:
        raise HTTPException(404, "Round not found")
    return _round_out(session, round_)


@router.patch("/{round_id}", response_model=RoundOut)
def update_round(
    round_id: int,
    payload: RoundPatch,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RoundOut:
    user = require_user(session, current)
    round_ = session.scalar(
        select(Round).where(Round.id == round_id, Round.user_id == user.id)
    )
    if round_ is None:
        raise HTTPException(404, "Round not found")
    if payload.visibility == "public" and session.scalar(
        select(UserCourseRating.id).where(UserCourseRating.round_id == round_.id)
    ) is not None:
        raise HTTPException(422, "Rating-owned rounds cannot be public")
    if "played_on" in payload.model_fields_set and payload.played_on is not None:
        round_.played_on = payload.played_on
    if "score" in payload.model_fields_set:
        round_.score = payload.score
    if payload.visibility is not None:
        round_.visibility = payload.visibility
    if "note" in payload.model_fields_set:
        note = session.get(RoundNote, round_.id)
        if payload.note:
            if note is None:
                note = RoundNote(round_id=round_.id, body=payload.note)
            else:
                note.body = payload.note
            session.add(note)
        elif note is not None:
            session.delete(note)
    event = session.scalar(
        select(ActivityEvent).where(
            ActivityEvent.subject_type == "round",
            ActivityEvent.subject_id == round_.id,
            ActivityEvent.actor_user_id == user.id,
        )
    )
    if event is not None:
        event.visibility = round_.visibility
        event.event_data = _event_data(round_)
    _refresh_course_state(session, user.id, round_.course_id)
    session.commit()
    return _round_out(session, round_)


@router.delete("/{round_id}", status_code=204)
def delete_round(
    round_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    round_ = session.scalar(
        select(Round).where(Round.id == round_id, Round.user_id == user.id)
    )
    if round_ is None:
        raise HTTPException(404, "Round not found")
    course_id = round_.course_id
    session.execute(
        delete(ActivityEvent).where(
            ActivityEvent.subject_type == "round",
            ActivityEvent.subject_id == round_.id,
            ActivityEvent.actor_user_id == user.id,
        )
    )
    session.execute(delete(RoundNote).where(RoundNote.round_id == round_.id))
    session.delete(round_)
    session.flush()
    _refresh_course_state(session, user.id, course_id)
    session.commit()
    return Response(status_code=204)


@course_state_router.get("", response_model=list[CourseStateOut])
def list_course_states(
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[CourseStateOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    states = session.scalars(
        select(UserCourseState)
        .where(UserCourseState.user_id == user.id, UserCourseState.has_played.is_(True))
        .order_by(UserCourseState.last_played_on.desc())
    ).all()
    output: list[CourseStateOut] = []
    for state in states:
        course = session.get(Course, state.course_id)
        if course is not None:
            output.append(
                CourseStateOut(
                    course=course_data(course),
                    has_played=state.has_played,
                    round_count=state.round_count,
                    last_played_on=state.last_played_on,
                )
            )
    return output
