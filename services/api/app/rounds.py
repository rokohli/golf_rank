from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_course, require_user, stored_user
from .models import (
    ActivityEvent,
    Comparison,
    Course,
    Follow,
    OnboardingPreference,
    RankingConfidence,
    Round,
    RoundCompanion,
    RoundNote,
    TierAssignment,
    User,
    UserCourseState,
)
from .schemas import CourseOut


router = APIRouter(prefix="/api/v1/me/rounds", tags=["rounds"])
course_state_router = APIRouter(prefix="/api/v1/me/course-states", tags=["rounds"])
Visibility = Literal["private", "friends", "public"]


class RoundIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: int = Field(gt=0)
    played_on: date
    score: int | None = Field(default=None, ge=40, le=250)
    note: str | None = Field(default=None, max_length=5000)
    favorite_hole: int | None = Field(default=None, ge=1, le=18)
    friend_user_ids: list[int] = Field(default_factory=list, max_length=40)
    guest_names: list[str] = Field(default_factory=list, max_length=20)
    visibility: Visibility = "friends"
    is_favorite: bool = False

    @field_validator("played_on")
    @classmethod
    def played_round_cannot_be_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("played_on cannot be in the future")
        return value

    @field_validator("guest_names")
    @classmethod
    def normalize_guest_names(cls, values: list[str]) -> list[str]:
        names = list(dict.fromkeys(value.strip() for value in values))
        if any(not name or len(name) > 120 for name in names):
            raise ValueError("guest names must be between 1 and 120 characters")
        return names


class RoundPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    played_on: date | None = None
    score: int | None = Field(default=None, ge=40, le=250)
    note: str | None = Field(default=None, max_length=5000)
    favorite_hole: int | None = Field(default=None, ge=1, le=18)
    friend_user_ids: list[int] | None = Field(default=None, max_length=40)
    guest_names: list[str] | None = Field(default=None, max_length=20)
    visibility: Visibility | None = None
    is_favorite: bool | None = None

    @field_validator("played_on")
    @classmethod
    def played_round_cannot_be_in_future(cls, value: date | None) -> date | None:
        if value is not None and value > date.today():
            raise ValueError("played_on cannot be in the future")
        return value

    @field_validator("guest_names")
    @classmethod
    def normalize_guest_names(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        names = list(dict.fromkeys(value.strip() for value in values))
        if any(not name or len(name) > 120 for name in names):
            raise ValueError("guest names must be between 1 and 120 characters")
        return names

    @model_validator(mode="after")
    def companion_lists_are_updated_together(self) -> "RoundPatch":
        supplied = self.model_fields_set
        if ("friend_user_ids" in supplied) != ("guest_names" in supplied):
            raise ValueError("friend_user_ids and guest_names must be supplied together")
        return self


class RoundCompanionOut(BaseModel):
    friend_user_id: int | None
    display_name: str | None
    guest_name: str | None


class RoundOut(BaseModel):
    id: int
    course: CourseOut
    played_on: date
    score: int | None
    note: str | None
    favorite_hole: int | None
    companions: list[RoundCompanionOut]
    visibility: Visibility
    is_favorite: bool
    is_rating_round: bool
    created_at: datetime
    updated_at: datetime


class RoundSummaryOut(BaseModel):
    total_rounds: int
    rounds_this_year: int
    average_score: float | None
    best_score: int | None
    distinct_courses: int
    latest_round: RoundOut | None


class CourseStateOut(BaseModel):
    course: CourseOut
    has_played: bool
    round_count: int
    last_played_on: date | None


def _round_out(session: Session, round_: Round) -> RoundOut:
    course = session.get(Course, round_.course_id)
    note = session.get(RoundNote, round_.id)
    assert course is not None
    companions = session.scalars(
        select(RoundCompanion)
        .where(RoundCompanion.round_id == round_.id)
        .order_by(RoundCompanion.id)
    ).all()
    companion_output: list[RoundCompanionOut] = []
    for companion in companions:
        display_name = None
        if companion.friend_user_id is not None:
            preferences = session.get(OnboardingPreference, companion.friend_user_id)
            onboarding = preferences.onboarding_data if preferences and preferences.onboarding_data else {}
            display_name = " ".join(
                item for item in (onboarding.get("first_name"), onboarding.get("last_name")) if item
            ).strip() or f"Golfer {companion.friend_user_id}"
        companion_output.append(RoundCompanionOut(
            friend_user_id=companion.friend_user_id,
            display_name=display_name,
            guest_name=companion.guest_name,
        ))
    return RoundOut(
        id=round_.id,
        course=course_data(course),
        played_on=round_.played_on,
        score=round_.score,
        note=note.body if note else None,
        favorite_hole=round_.favorite_hole,
        companions=companion_output,
        visibility=round_.visibility,
        is_favorite=round_.is_favorite,
        is_rating_round=round_.is_rating_round,
        created_at=round_.created_at,
        updated_at=round_.updated_at,
    )


def _validate_friend_ids(session: Session, user_id: int, friend_user_ids: list[int]) -> list[int]:
    friend_ids = list(dict.fromkeys(friend_user_ids))
    if not friend_ids:
        return []
    user_ids = set(session.scalars(select(User.id).where(User.id.in_(friend_ids))).all())
    followed_ids = set(session.scalars(
        select(Follow.followed_id).where(
            Follow.follower_id == user_id,
            Follow.followed_id.in_(friend_ids),
        )
    ).all())
    if user_ids != set(friend_ids) or followed_ids != set(friend_ids):
        raise HTTPException(422, "All friend_user_ids must be followed users")
    return friend_ids


def _replace_companions(
    session: Session,
    round_id: int,
    friend_user_ids: list[int],
    guest_names: list[str],
) -> None:
    session.execute(delete(RoundCompanion).where(RoundCompanion.round_id == round_id))
    session.flush()
    session.add_all(
        [RoundCompanion(round_id=round_id, friend_user_id=friend_id) for friend_id in friend_user_ids]
        + [RoundCompanion(round_id=round_id, guest_name=name) for name in guest_names]
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


def _delete_rating_ranking_evidence(
    session: Session, user_id: int, course_id: int
) -> None:
    session.execute(
        delete(Comparison).where(
            Comparison.user_id == user_id,
            or_(
                Comparison.course_a_id == course_id,
                Comparison.course_b_id == course_id,
            ),
        )
    )
    session.execute(
        delete(RankingConfidence).where(
            RankingConfidence.user_id == user_id,
            RankingConfidence.course_id == course_id,
        )
    )
    session.execute(
        delete(TierAssignment).where(
            TierAssignment.user_id == user_id,
            TierAssignment.course_id == course_id,
        )
    )


def _delete_round_activity_event(session: Session, user_id: int, round_id: int) -> None:
    session.execute(
        delete(ActivityEvent).where(
            ActivityEvent.subject_type.in_(("round", "rating_round")),
            ActivityEvent.subject_id == round_id,
            ActivityEvent.actor_user_id == user_id,
        )
    )


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
        favorite_hole=payload.favorite_hole,
        is_favorite=payload.is_favorite,
        visibility=payload.visibility,
    )
    session.add(round_)
    session.flush()
    if payload.note:
        session.add(RoundNote(round_id=round_.id, body=payload.note))
    friend_ids = _validate_friend_ids(session, user.id, payload.friend_user_ids)
    _replace_companions(session, round_.id, friend_ids, payload.guest_names)
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
    year: int | None = Query(default=None, ge=1900, le=2200),
    favorites_only: bool = False,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[RoundOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    statement = select(Round).where(Round.user_id == user.id)
    if year is not None:
        statement = statement.where(func.extract("year", Round.played_on) == year)
    if favorites_only:
        statement = statement.where(Round.is_favorite.is_(True))
    rounds = session.scalars(
        statement
        .order_by(Round.played_on.desc(), Round.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [_round_out(session, item) for item in rounds]


@router.get("/summary", response_model=RoundSummaryOut)
def round_summary(
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RoundSummaryOut:
    user = stored_user(session, current)
    if user is None:
        return RoundSummaryOut(
            total_rounds=0,
            rounds_this_year=0,
            average_score=None,
            best_score=None,
            distinct_courses=0,
            latest_round=None,
        )
    total, average, best, distinct = session.execute(
        select(
            func.count(Round.id),
            func.avg(Round.score),
            func.min(Round.score),
            func.count(func.distinct(Round.course_id)),
        ).where(Round.user_id == user.id)
    ).one()
    this_year = session.scalar(
        select(func.count(Round.id)).where(
            Round.user_id == user.id,
            func.extract("year", Round.played_on) == date.today().year,
        )
    ) or 0
    latest = session.scalar(
        select(Round)
        .where(Round.user_id == user.id)
        .order_by(Round.played_on.desc(), Round.id.desc())
        .limit(1)
    )
    return RoundSummaryOut(
        total_rounds=int(total),
        rounds_this_year=int(this_year),
        average_score=round(float(average), 1) if average is not None else None,
        best_score=int(best) if best is not None else None,
        distinct_courses=int(distinct),
        latest_round=_round_out(session, latest) if latest else None,
    )


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
    if payload.visibility == "public" and round_.is_rating_round:
        raise HTTPException(422, "Rating-owned rounds cannot be public")
    if "played_on" in payload.model_fields_set and payload.played_on is not None:
        round_.played_on = payload.played_on
    if "score" in payload.model_fields_set:
        round_.score = payload.score
    if "favorite_hole" in payload.model_fields_set:
        round_.favorite_hole = payload.favorite_hole
    if payload.is_favorite is not None:
        round_.is_favorite = payload.is_favorite
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
    if payload.friend_user_ids is not None and payload.guest_names is not None:
        friend_ids = _validate_friend_ids(session, user.id, payload.friend_user_ids)
        _replace_companions(session, round_.id, friend_ids, payload.guest_names)
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
    is_rating_round = round_.is_rating_round
    if is_rating_round:
        # Keep the import local: course_ratings imports round state helpers.
        from .ranking import _lock_user_for_ranking_update, _stage_snapshot

        _lock_user_for_ranking_update(session, user.id)
    _delete_round_activity_event(session, user.id, round_.id)
    session.execute(delete(RoundNote).where(RoundNote.round_id == round_.id))
    session.execute(delete(RoundCompanion).where(RoundCompanion.round_id == round_.id))
    if is_rating_round:
        _delete_rating_ranking_evidence(session, user.id, course_id)
    session.delete(round_)
    session.flush()
    _refresh_course_state(session, user.id, course_id)
    if is_rating_round:
        _stage_snapshot(session, user.id)
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
