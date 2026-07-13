from datetime import UTC, date, datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_user, stored_user
from .models import (
    Course,
    ItineraryItem,
    Plan,
    PlanCandidate,
    PlanConstraint,
    RankingSnapshot,
    SavedCourse,
    SavedList,
    UserCourseState,
)
from .schemas import CourseOut


router = APIRouter(prefix="/api/v1/me/plans", tags=["plans"])


class PlanIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    start_date: date
    end_date: date
    party_size: int = Field(default=4, ge=1, le=16)
    max_green_fee: int | None = Field(default=None, ge=0, le=5000)
    access: Literal["public", "private", "any"] = "any"
    difficulty: Literal["beginner", "intermediate", "challenging", "any"] = "any"
    regions: list[str] = Field(default_factory=list, max_length=20)
    origin_latitude: float | None = Field(default=None, ge=-90, le=90)
    origin_longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_miles: float | None = Field(default=None, gt=0, le=2000)
    transportation: Literal["walking", "cart", "either"] = "either"
    tee_time_window: str | None = Field(default=None, max_length=80)
    must_haves: list[str] = Field(default_factory=list, max_length=20)
    max_candidates: int = Field(default=5, ge=1, le=10)

    @model_validator(mode="after")
    def validate_constraints(self) -> "PlanIn":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if (self.end_date - self.start_date).days > 30:
            raise ValueError("plans can span at most 31 days")
        coordinates = (self.origin_latitude, self.origin_longitude)
        if (coordinates[0] is None) != (coordinates[1] is None):
            raise ValueError("origin_latitude and origin_longitude must be provided together")
        if self.radius_miles is not None and coordinates[0] is None:
            raise ValueError("an origin is required when radius_miles is set")
        return self


class PlanCandidateOut(BaseModel):
    position: int
    course: CourseOut
    score: float
    distance_miles: float | None
    reasons: list[str]
    caveats: list[str]
    source_checked_at: datetime


class ItineraryItemOut(BaseModel):
    id: int
    date: date
    position: int
    title: str
    course: CourseOut | None
    start_time: str | None
    details: dict


class PlanOut(BaseModel):
    id: int
    title: str
    start_date: date
    end_date: date
    status: Literal["draft", "saved"]
    constraints: dict
    candidates: list[PlanCandidateOut]
    itinerary: list[ItineraryItemOut]
    created_at: datetime
    updated_at: datetime


class PlanSummaryOut(BaseModel):
    id: int
    title: str
    start_date: date
    end_date: date
    status: Literal["draft", "saved"]
    candidate_count: int
    created_at: datetime
    updated_at: datetime


def _distance_miles(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    earth_radius = 3958.8
    delta_lat = radians(lat_b - lat_a)
    delta_lon = radians(lon_b - lon_a)
    value = sin(delta_lat / 2) ** 2 + cos(radians(lat_a)) * cos(radians(lat_b)) * sin(delta_lon / 2) ** 2
    return earth_radius * 2 * asin(sqrt(value))


def _ranking_signal(session: Session, user_id: int) -> dict[int, tuple[float, float]]:
    snapshot = session.scalar(
        select(RankingSnapshot)
        .where(RankingSnapshot.user_id == user_id)
        .order_by(RankingSnapshot.version.desc())
        .limit(1)
    )
    if snapshot is None:
        return {}
    return {
        entry["course"]["id"]: (entry["personal_rating"], entry["confidence"])
        for entry in snapshot.ranking_data.get("entries", [])
    }


def _candidate_rows(session: Session, user_id: int, payload: PlanIn) -> list[dict]:
    statement = select(Course)
    if payload.max_green_fee is not None:
        statement = statement.where(Course.green_fee <= payload.max_green_fee)
    if payload.access != "any":
        statement = statement.where(Course.is_public == (payload.access == "public"))
    if payload.difficulty != "any":
        statement = statement.where(Course.difficulty == payload.difficulty)
    if payload.regions:
        statement = statement.where(Course.region.in_(payload.regions))
    courses = list(session.scalars(statement).all())

    ranking = _ranking_signal(session, user_id)
    saved_ids = set(
        session.scalars(
            select(SavedCourse.course_id)
            .join(SavedList, SavedList.id == SavedCourse.list_id)
            .where(SavedList.user_id == user_id)
        ).all()
    )
    played_ids = set(
        session.scalars(
            select(UserCourseState.course_id).where(
                UserCourseState.user_id == user_id,
                UserCourseState.has_played.is_(True),
            )
        ).all()
    )
    checked_at = datetime.now(UTC)
    candidates: list[dict] = []
    for course in courses:
        distance = None
        if payload.origin_latitude is not None and payload.origin_longitude is not None:
            distance = _distance_miles(
                payload.origin_latitude,
                payload.origin_longitude,
                course.latitude,
                course.longitude,
            )
            if payload.radius_miles is not None and distance > payload.radius_miles:
                continue
        personal_rating, confidence = ranking.get(course.id, (5.0, 0.0))
        budget_fit = 0.0
        if payload.max_green_fee:
            budget_fit = max(0.0, 10 * (1 - course.green_fee / payload.max_green_fee))
        score = personal_rating * 6 + confidence * 10 + budget_fit
        reasons: list[str] = []
        caveats = ["Tee-time availability has not been verified."]
        if course.id in ranking:
            reasons.append(f"Your comparison-based rating is {personal_rating:.1f}/10.")
        else:
            caveats.append("No personal comparison signal exists for this course yet.")
        if course.id in saved_ids:
            score += 15
            reasons.append("You saved this course.")
        if course.id not in played_ids:
            score += 5
            reasons.append("This would add a new course to your played list.")
        if payload.max_green_fee is not None:
            reasons.append(f"The ${course.green_fee} green fee is within your budget.")
        if distance is not None:
            reasons.append(f"Approximately {distance:.0f} miles from your origin.")
        if payload.must_haves:
            caveats.append("Requested must-haves require confirmation from a current course source.")
        candidates.append(
            {
                "course": course,
                "score": round(score, 1),
                "distance": round(distance, 1) if distance is not None else None,
                "reasons": reasons,
                "caveats": caveats,
                "checked_at": checked_at,
            }
        )
    return sorted(candidates, key=lambda item: (-item["score"], item["course"].name))[
        : payload.max_candidates
    ]


def _replace_plan_data(session: Session, user_id: int, plan: Plan, payload: PlanIn) -> None:
    plan.title = payload.title.strip()
    plan.start_date = payload.start_date
    plan.end_date = payload.end_date
    session.add(plan)
    session.flush()
    constraint_data = payload.model_dump(mode="json", exclude={"title", "start_date", "end_date"})
    constraints = session.get(PlanConstraint, plan.id)
    if constraints is None:
        constraints = PlanConstraint(plan_id=plan.id, constraint_data=constraint_data)
    else:
        constraints.constraint_data = constraint_data
    session.add(constraints)
    session.execute(delete(ItineraryItem).where(ItineraryItem.plan_id == plan.id))
    session.execute(delete(PlanCandidate).where(PlanCandidate.plan_id == plan.id))
    session.flush()

    candidates = _candidate_rows(session, user_id, payload)
    day_count = (payload.end_date - payload.start_date).days + 1
    for index, candidate in enumerate(candidates, start=1):
        course = candidate["course"]
        session.add(
            PlanCandidate(
                plan_id=plan.id,
                course_id=course.id,
                position=index,
                score=candidate["score"],
                distance_miles=candidate["distance"],
                reasons=candidate["reasons"],
                caveats=candidate["caveats"],
                source_checked_at=candidate["checked_at"],
            )
        )
        if index <= day_count:
            item_date = payload.start_date + timedelta(days=index - 1)
            session.add(
                ItineraryItem(
                    plan_id=plan.id,
                    course_id=course.id,
                    item_date=item_date,
                    position=index,
                    title=f"Play {course.name}",
                    start_time=None,
                    details={
                        "tee_time_window": payload.tee_time_window,
                        "availability_verified": False,
                    },
                )
            )


def _require_plan(session: Session, user_id: int, plan_id: int) -> Plan:
    plan = session.scalar(select(Plan).where(Plan.id == plan_id, Plan.user_id == user_id))
    if plan is None:
        raise HTTPException(404, "Plan not found")
    return plan


def _plan_out(session: Session, plan: Plan) -> PlanOut:
    constraints = session.get(PlanConstraint, plan.id)
    candidate_rows = session.scalars(
        select(PlanCandidate)
        .where(PlanCandidate.plan_id == plan.id)
        .order_by(PlanCandidate.position)
    ).all()
    candidates: list[PlanCandidateOut] = []
    for candidate in candidate_rows:
        course = session.get(Course, candidate.course_id)
        if course is not None:
            candidates.append(
                PlanCandidateOut(
                    position=candidate.position,
                    course=course_data(course),
                    score=candidate.score,
                    distance_miles=candidate.distance_miles,
                    reasons=candidate.reasons,
                    caveats=candidate.caveats,
                    source_checked_at=candidate.source_checked_at,
                )
            )
    itinerary_rows = session.scalars(
        select(ItineraryItem)
        .where(ItineraryItem.plan_id == plan.id)
        .order_by(ItineraryItem.item_date, ItineraryItem.position)
    ).all()
    itinerary: list[ItineraryItemOut] = []
    for item in itinerary_rows:
        course = session.get(Course, item.course_id) if item.course_id else None
        itinerary.append(
            ItineraryItemOut(
                id=item.id,
                date=item.item_date,
                position=item.position,
                title=item.title,
                course=course_data(course) if course else None,
                start_time=item.start_time,
                details=item.details,
            )
        )
    return PlanOut(
        id=plan.id,
        title=plan.title,
        start_date=plan.start_date,
        end_date=plan.end_date,
        status=plan.status,
        constraints=constraints.constraint_data if constraints else {},
        candidates=candidates,
        itinerary=itinerary,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(
    payload: PlanIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> PlanOut:
    user = require_user(session, current, create=True)
    plan = Plan(
        user_id=user.id,
        title=payload.title.strip(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="draft",
    )
    session.add(plan)
    _replace_plan_data(session, user.id, plan, payload)
    session.commit()
    return _plan_out(session, plan)


@router.put("/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int,
    payload: PlanIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> PlanOut:
    user = require_user(session, current)
    plan = _require_plan(session, user.id, plan_id)
    _replace_plan_data(session, user.id, plan, payload)
    session.commit()
    return _plan_out(session, plan)


@router.post("/{plan_id}/save", response_model=PlanOut)
def save_plan(
    plan_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> PlanOut:
    user = require_user(session, current)
    plan = _require_plan(session, user.id, plan_id)
    plan.status = "saved"
    session.commit()
    return _plan_out(session, plan)


@router.get("", response_model=list[PlanSummaryOut])
def list_plans(
    limit: int = Query(default=50, ge=1, le=100),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[PlanSummaryOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    plans = session.scalars(
        select(Plan)
        .where(Plan.user_id == user.id)
        .order_by(Plan.created_at.desc(), Plan.id.desc())
        .limit(limit)
    ).all()
    return [
        PlanSummaryOut(
            id=plan.id,
            title=plan.title,
            start_date=plan.start_date,
            end_date=plan.end_date,
            status=plan.status,
            candidate_count=len(
                session.scalars(
                    select(PlanCandidate.id).where(PlanCandidate.plan_id == plan.id)
                ).all()
            ),
            created_at=plan.created_at,
            updated_at=plan.updated_at,
        )
        for plan in plans
    ]


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(
    plan_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> PlanOut:
    user = require_user(session, current)
    return _plan_out(session, _require_plan(session, user.id, plan_id))


@router.delete("/{plan_id}", status_code=204)
def delete_plan(
    plan_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    plan = _require_plan(session, user.id, plan_id)
    session.delete(plan)
    session.commit()
    return Response(status_code=204)
