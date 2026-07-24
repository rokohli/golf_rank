import logging
import time
from datetime import UTC, date, datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.rate_limit import ai_planner_rate_limit
from .db import get_session
from .domain import canonical_courses_only, course_data, require_course, require_user, stored_user
from .models import (
    Course,
    ItineraryItem,
    Plan,
    PlanCandidate,
    PlanConstraint,
    PlanGeneration,
    RankingSnapshot,
    SavedCourse,
    SavedList,
    UserCourseState,
)
from .planner_narrative import (
    PROMPT_VERSION,
    NarrativeCandidate,
    PlannerNarrativeOutput,
    PlannerNarrativeProviderError,
    PlannerNarrativeRequest,
    PlannerNarrativeResult,
)
from .schemas import CourseOut


router = APIRouter(prefix="/api/v1/me/plans", tags=["plans"])
logger = logging.getLogger("fairway.planner")


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


class AIPlanOut(PlanOut):
    generation_status: Literal["generated", "fallback"]
    generated_summary: str
    fallback_reason: str | None = None


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
    base_statement = select(Course).where(Course.status == "active", canonical_courses_only())
    region_filter = None
    if payload.regions:
        region_filter = or_(*[
            or_(Course.region.ilike(f"%{region}%"), Course.city.ilike(f"%{region}%"))
            for region in payload.regions
        ])
    statement = base_statement.where(region_filter) if region_filter is not None else base_statement
    if payload.max_green_fee is not None:
        statement = statement.where(or_(
            Course.green_fee <= payload.max_green_fee,
            Course.green_fee.is_(None),
        ))
    if payload.access != "any":
        statement = statement.where(Course.is_public == (payload.access == "public"))
    if payload.difficulty != "any":
        statement = statement.where(Course.difficulty == payload.difficulty)
    courses = list(session.scalars(statement).all())
    origin_latitude = payload.origin_latitude
    origin_longitude = payload.origin_longitude
    if origin_latitude is None and region_filter is not None:
        destination_courses = list(session.scalars(base_statement.where(region_filter)).all())
        if destination_courses:
            origin_latitude = sum(course.latitude for course in destination_courses) / len(destination_courses)
            origin_longitude = sum(course.longitude for course in destination_courses) / len(destination_courses)

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
        if origin_latitude is not None and origin_longitude is not None:
            distance = _distance_miles(
                origin_latitude,
                origin_longitude,
                course.latitude,
                course.longitude,
            )
            if payload.radius_miles is not None and distance > payload.radius_miles:
                continue
        personal_rating, confidence = ranking.get(course.id, (5.0, 0.0))
        budget_fit = 0.0
        if payload.max_green_fee and course.green_fee is not None:
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
        if payload.max_green_fee is not None and course.green_fee is not None:
            reasons.append(f"The ${course.green_fee} green fee is within your budget.")
        elif course.green_fee is None:
            caveats.append("The current green fee is unknown and must be confirmed.")
        if distance is not None:
            reasons.append(f"Approximately {distance:.0f} miles from the destination center.")
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
    plan.status = "draft"
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


def _candidate_records(session: Session, plan_id: int) -> list[PlanCandidate]:
    return list(session.scalars(
        select(PlanCandidate)
        .where(PlanCandidate.plan_id == plan_id)
        .order_by(PlanCandidate.position)
    ).all())


def _deterministic_summary(plan: Plan, candidate_count: int) -> str:
    if candidate_count == 0:
        return f"No validated course candidates are currently available for {plan.title}."
    noun = "candidate" if candidate_count == 1 else "candidates"
    return (
        f"Using Fairway's {candidate_count} validated course {noun} for {plan.title}; "
        "prices and tee-time availability remain subject to the listed caveats."
    )


def _narrative_request(
    session: Session,
    plan: Plan,
    constraint_data: dict,
    candidate_rows: list[PlanCandidate],
) -> PlannerNarrativeRequest:
    candidates: list[NarrativeCandidate] = []
    has_personal_signal = False
    for candidate in candidate_rows:
        course = require_course(session, candidate.course_id)
        has_personal_signal = has_personal_signal or any(
            "your" in reason.lower() for reason in candidate.reasons
        )
        candidates.append(NarrativeCandidate(
            course_id=course.id,
            name=course.name,
            reasons=candidate.reasons,
            caveats=candidate.caveats,
        ))
    summary_options = [
        (
            f"A {min(len(candidates), (plan.end_date - plan.start_date).days + 1)}-course "
            f"itinerary for {plan.title}, organized from Fairway's validated candidates."
        ),
        (
            f"A candidate-led itinerary for {plan.title}; prices and tee-time availability "
            "remain subject to the listed caveats."
        ),
    ]
    if has_personal_signal:
        summary_options.append(
            f"A personalized itinerary for {plan.title}, ordered from Fairway's known user signals."
        )
    preference_keys = {
        "party_size",
        "max_green_fee",
        "access",
        "difficulty",
        "regions",
        "radius_miles",
        "transportation",
        "tee_time_window",
        "must_haves",
    }
    return PlannerNarrativeRequest(
        title=plan.title,
        start_date=plan.start_date,
        end_date=plan.end_date,
        preferences={
            key: value for key, value in constraint_data.items() if key in preference_keys
        },
        candidates=candidates,
        summary_options=summary_options,
    )


def _validated_items(
    output: PlannerNarrativeOutput,
    request: PlannerNarrativeRequest,
) -> list[tuple[date, NarrativeCandidate, list[str]]]:
    candidate_by_id = {candidate.course_id: candidate for candidate in request.candidates}
    expected_count = min(
        len(candidate_by_id), (request.end_date - request.start_date).days + 1
    )
    if output.summary not in request.summary_options:
        raise ValueError("unsupported summary")
    if len(output.itinerary) != expected_count:
        raise ValueError("incomplete itinerary")
    if output.ordered_course_ids != [item.course_id for item in output.itinerary]:
        raise ValueError("course order does not match itinerary")
    if len(set(output.ordered_course_ids)) != len(output.ordered_course_ids):
        raise ValueError("duplicate course")
    itinerary_dates = [item.date for item in output.itinerary]
    if len(set(itinerary_dates)) != len(output.itinerary):
        raise ValueError("duplicate date")
    if itinerary_dates != sorted(itinerary_dates):
        raise ValueError("dates are not ordered")

    validated: list[tuple[date, NarrativeCandidate, list[str]]] = []
    for item in output.itinerary:
        if not request.start_date <= item.date <= request.end_date:
            raise ValueError("date outside plan")
        candidate = candidate_by_id.get(item.course_id)
        if candidate is None:
            raise ValueError("unknown course")
        if len(set(item.reason_indices)) != len(item.reason_indices):
            raise ValueError("duplicate reason")
        if any(index < 0 or index >= len(candidate.reasons) for index in item.reason_indices):
            raise ValueError("unknown reason")
        validated.append((
            item.date,
            candidate,
            [candidate.reasons[index] for index in item.reason_indices],
        ))
    return validated


def _generation_response(
    session: Session,
    plan: Plan,
    *,
    status: Literal["generated", "fallback"],
    summary: str,
    fallback_reason: str | None = None,
) -> AIPlanOut:
    return AIPlanOut(
        **_plan_out(session, plan).model_dump(),
        generation_status=status,
        generated_summary=summary,
        fallback_reason=fallback_reason,
    )


def _record_generation(
    session: Session,
    plan_id: int,
    *,
    status: Literal["succeeded", "fallback"],
    provider: str,
    model_identifier: str | None,
    summary: str,
    latency_ms: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    estimated_cost_micros: int | None = None,
    fallback_reason: str | None = None,
) -> None:
    session.add(PlanGeneration(
        plan_id=plan_id,
        status=status,
        provider=provider,
        model_identifier=model_identifier,
        prompt_version=PROMPT_VERSION,
        latency_ms=latency_ms,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        estimated_cost_micros=estimated_cost_micros,
        fallback_reason=fallback_reason,
        generated_summary=summary,
    ))


def _plan_out(session: Session, plan: Plan) -> PlanOut:
    constraints = session.get(PlanConstraint, plan.id)
    candidate_rows = session.scalars(
        select(PlanCandidate)
        .where(PlanCandidate.plan_id == plan.id)
        .order_by(PlanCandidate.position)
    ).all()
    candidates: list[PlanCandidateOut] = []
    for candidate in candidate_rows:
        try:
            course = require_course(session, candidate.course_id)
        except HTTPException:
            course = None
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
        try:
            course = require_course(session, item.course_id) if item.course_id else None
        except HTTPException:
            course = None
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


@router.post("/{plan_id}/ai-itinerary", response_model=AIPlanOut)
async def generate_ai_itinerary(
    plan_id: int,
    request: Request,
    _ai_limit: None = Depends(ai_planner_rate_limit),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> AIPlanOut:
    user = require_user(session, current)
    plan = _require_plan(session, user.id, plan_id)
    settings = request.app.state.settings
    candidate_rows = _candidate_records(session, plan.id)
    deterministic_summary = _deterministic_summary(plan, len(candidate_rows))

    def fallback(reason: str, *, latency_ms: int | None = None) -> AIPlanOut:
        _record_generation(
            session,
            plan.id,
            status="fallback",
            provider=settings.ai_planner_provider,
            model_identifier=(settings.ai_planner_model if settings.ai_planner_enabled else None),
            summary=deterministic_summary,
            latency_ms=latency_ms,
            fallback_reason=reason,
        )
        session.commit()
        return _generation_response(
            session,
            plan,
            status="fallback",
            summary=deterministic_summary,
            fallback_reason=reason,
        )

    provider = request.app.state.planner_narrative_provider
    if not settings.ai_planner_enabled or provider is None:
        return fallback("disabled")
    allowed_subjects = settings.ai_planner_allowed_subject_set
    if allowed_subjects and current.provider_subject not in allowed_subjects:
        return fallback("restricted")
    if not candidate_rows:
        return fallback("no_candidates")

    now = datetime.now(UTC)
    month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    monthly_cost = session.scalar(
        select(func.coalesce(func.sum(PlanGeneration.estimated_cost_micros), 0)).where(
            PlanGeneration.created_at >= month_start,
        )
    )
    if int(monthly_cost or 0) >= settings.ai_planner_monthly_cost_limit_cents * 10_000:
        return fallback("monthly_cost_limit")

    constraints = session.get(PlanConstraint, plan.id)
    narrative_request = _narrative_request(
        session,
        plan,
        constraints.constraint_data if constraints else {},
        candidate_rows,
    )
    session.commit()
    started_at = time.perf_counter()
    try:
        result: PlannerNarrativeResult = await provider.generate(narrative_request)
    except TimeoutError:
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        logger.warning("planner_generation_fallback reason=timeout")
        return fallback("timeout", latency_ms=latency_ms)
    except PlannerNarrativeProviderError as error:
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        logger.warning(
            "planner_generation_fallback reason=provider_error error_type=%s",
            type(error).__name__,
        )
        return fallback("provider_error", latency_ms=latency_ms)
    except Exception as error:
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        logger.warning(
            "planner_generation_fallback reason=provider_error error_type=%s",
            type(error).__name__,
        )
        return fallback("provider_error", latency_ms=latency_ms)

    latency_ms = round((time.perf_counter() - started_at) * 1000)
    session.expire_all()
    plan = _require_plan(session, user.id, plan_id)
    current_candidates = _candidate_records(session, plan.id)
    current_constraints = session.get(PlanConstraint, plan.id)
    current_narrative_request = _narrative_request(
        session,
        plan,
        current_constraints.constraint_data if current_constraints else {},
        current_candidates,
    )
    if current_narrative_request != narrative_request:
        return fallback("plan_changed", latency_ms=latency_ms)
    try:
        validated_items = _validated_items(result.output, current_narrative_request)
    except ValueError:
        logger.warning("planner_generation_fallback reason=invalid_output")
        _record_generation(
            session,
            plan.id,
            status="fallback",
            provider=result.provider,
            model_identifier=result.model_identifier,
            summary=deterministic_summary,
            latency_ms=latency_ms,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            estimated_cost_micros=result.estimated_cost_micros,
            fallback_reason="invalid_output",
        )
        session.commit()
        return _generation_response(
            session,
            plan,
            status="fallback",
            summary=deterministic_summary,
            fallback_reason="invalid_output",
        )

    course_by_id = {
        candidate.course_id: require_course(session, candidate.course_id)
        for candidate in current_candidates
    }
    session.execute(delete(ItineraryItem).where(ItineraryItem.plan_id == plan.id))
    for position, (item_date, candidate, reasons) in enumerate(validated_items, start=1):
        course = course_by_id[candidate.course_id]
        session.add(ItineraryItem(
            plan_id=plan.id,
            course_id=course.id,
            item_date=item_date,
            position=position,
            title=f"Play {course.name}",
            start_time=None,
            details={
                "ai_generated": True,
                "availability_verified": False,
                "tee_time_window": narrative_request.preferences.get("tee_time_window"),
                "rationale": reasons,
                "caveats": candidate.caveats,
            },
        ))
    plan.status = "draft"
    plan.updated_at = datetime.now(UTC)
    _record_generation(
        session,
        plan.id,
        status="succeeded",
        provider=result.provider,
        model_identifier=result.model_identifier,
        summary=result.output.summary,
        latency_ms=latency_ms,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        estimated_cost_micros=result.estimated_cost_micros,
    )
    session.commit()
    return _generation_response(
        session,
        plan,
        status="generated",
        summary=result.output.summary,
    )


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
