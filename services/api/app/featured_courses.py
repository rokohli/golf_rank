from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import threading
import time
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Any, Iterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .catalog import miles_between
from .core.auth import CurrentUser, current_user, get_settings
from .core.config import Settings
from .core.rate_limit import authenticated_rate_limit
from .db import get_session
from .domain import (
    canonical_courses_only,
    course_data,
    course_identity_ids,
    require_user,
    resolve_course_ids,
)
from .models import (
    Course,
    CourseImage,
    CourseImageModeration,
    DailyFeaturedCourse,
    OnboardingPreference,
    Profile,
    Round,
    SavedCourse,
    SavedList,
    User,
    UserCourseRating,
    UserCourseState,
)
from .saves import get_or_create_default_saved_list, save_course_to_default_list
from .schemas import CourseOut, FeaturedCourseOut

logger = logging.getLogger("fairway.featured_courses")

router = APIRouter(prefix="/api/v1/me/featured-course", tags=["featured-course"])

STATE_NAMES: dict[str, str] = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

TRAVEL_RADIUS_MAP: dict[str, float] = {
    "up to 15 minutes": 10.0,
    "up to 30 minutes": 20.0,
    "up to 45 minutes": 35.0,
    "up to 60 minutes": 50.0,
    "90+ minutes": 80.0,
}
DEFAULT_RADIUS_MILES = 35.0
MAX_DISMISSALS_PER_DAY = 3  # Sequence starts at 1, so sequence 4 is the last runner-up.


def current_week_anchor(d: date | None = None) -> date:
    """Returns the Monday date representing the anchor for the given date's week."""
    target = d or date.today()
    return target - timedelta(days=target.weekday())


class NarrativeSchema(BaseModel):
    headline: str = Field(min_length=1, max_length=120)
    rationale: str = Field(min_length=1, max_length=500)
    match_tags: list[str] = Field(min_length=1, max_length=4)


def monthly_ai_cost_micros(session: Session, model_cls: Any, cost_column: Any) -> int:
    """Helper to compute monthly AI spend across any model table with a created_at column."""
    now = datetime.now(UTC)
    month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    monthly_cost = session.scalar(
        select(func.coalesce(func.sum(cost_column), 0)).where(
            model_cls.created_at >= month_start,
        )
    )
    return int(monthly_cost or 0)


MAX_ESTIMATED_INPUT_TOKENS = 1_000
MAX_OUTPUT_TOKENS = 300


def estimate_max_request_cost_micros(settings: Settings) -> int:
    cost = (
        MAX_ESTIMATED_INPUT_TOKENS * settings.ai_planner_input_cost_micros_per_million_tokens
        + MAX_OUTPUT_TOKENS * settings.ai_planner_output_cost_micros_per_million_tokens
    ) // 1_000_000
    return max(2_500, cost)


class FeaturedCourseBudgetTracker:
    """Thread-safe budget tracker that reserves estimated AI spend before outbound calls.

    Prevents both boundary overruns (requests starting when headroom < worst_case_cost)
    and concurrency races (multiple requests reading stale unbilled spend).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._in_flight_micros = 0

    @property
    def in_flight_micros(self) -> int:
        with self._lock:
            return self._in_flight_micros

    def reset(self) -> None:
        with self._lock:
            self._in_flight_micros = 0

    @contextmanager
    def reserve(self, session: Session, settings: Settings) -> Iterator[bool]:
        if not settings.ai_planner_enabled or not settings.gemini_api_key:
            yield False
            return

        max_cost = estimate_max_request_cost_micros(settings)
        cost_limit_micros = settings.ai_featured_course_monthly_cost_limit_cents * 10_000

        reserved = False
        with self._lock:
            db_cost = monthly_ai_cost_micros(session, DailyFeaturedCourse, DailyFeaturedCourse.estimated_cost_micros)
            if db_cost + self._in_flight_micros + max_cost <= cost_limit_micros:
                self._in_flight_micros += max_cost
                reserved = True

        if not reserved:
            yield False
            return

        try:
            yield True
        finally:
            with self._lock:
                self._in_flight_micros -= max_cost


budget_tracker = FeaturedCourseBudgetTracker()
_generation_locks: dict[tuple[int, date], asyncio.Lock] = {}
_generation_locks_guard = asyncio.Lock()


async def _get_user_week_lock(user_id: int, target_date: date) -> asyncio.Lock:
    key = (user_id, target_date)
    async with _generation_locks_guard:
        if len(_generation_locks) > 10_000:
            _generation_locks.clear()
        if key not in _generation_locks:
            _generation_locks[key] = asyncio.Lock()
        return _generation_locks[key]


def extract_state_code(region_str: str | None) -> str | None:
    if not region_str:
        return None
    trailing = re.search(r"(?:^|,|\s)\s*([A-Za-z]{2})\s*$", region_str)
    if trailing and trailing.group(1).upper() in STATE_NAMES:
        return trailing.group(1).upper()
    if "," in region_str:
        segment = region_str.rsplit(",", 1)[-1].strip().casefold()
        for code, name in STATE_NAMES.items():
            if segment == name.casefold() or segment == code.casefold():
                return code
    normalized = region_str.strip().casefold()
    for code, name in STATE_NAMES.items():
        name_lower = name.casefold()
        if normalized == name_lower or normalized.endswith(" " + name_lower):
            return code
    return None


def _resolve_anchor_coordinates(
    session: Session,
    lat: float | None,
    lng: float | None,
    home_region: str | None,
) -> tuple[float | None, float | None]:
    if lat is not None and lng is not None:
        return lat, lng
    if not home_region:
        return None, None
    anchor = session.scalars(
        select(Course).where(
            Course.status == "active",
            canonical_courses_only(),
            or_(
                Course.region.ilike(f"%{home_region}%"),
                Course.city.ilike(f"%{home_region}%"),
            ),
            Course.latitude.is_not(None),
            Course.longitude.is_not(None),
        ).limit(1)
    ).first()
    if anchor and anchor.latitude is not None and anchor.longitude is not None:
        return anchor.latitude, anchor.longitude
    return None, None


def _get_user_exclusions(session: Session, user_id: int, today: date) -> tuple[set[int], set[int], set[int]]:
    """Returns (played_ids, recent_featured_ids, dismissed_today_ids)."""
    played_from_rounds = select(Round.course_id).where(Round.user_id == user_id)
    played_from_states = select(UserCourseState.course_id).where(
        UserCourseState.user_id == user_id,
        UserCourseState.has_played.is_(True),
    )
    raw_played = set(session.scalars(played_from_rounds.union(played_from_states)).all())
    played_ids = resolve_course_ids(session, raw_played) | raw_played

    # 60-day (~8.5 weeks) cooldown to prevent repeating courses across weekly picks
    past_cutoff = today - timedelta(days=60)
    raw_past = set(session.scalars(
        select(DailyFeaturedCourse.course_id).where(
            DailyFeaturedCourse.user_id == user_id,
            DailyFeaturedCourse.recommendation_date >= past_cutoff,
        )
    ).all())
    past_featured = resolve_course_ids(session, raw_past) | raw_past

    raw_dismissed = set(session.scalars(
        select(DailyFeaturedCourse.course_id).where(
            DailyFeaturedCourse.user_id == user_id,
            DailyFeaturedCourse.recommendation_date == today,
        )
    ).all())
    dismissed_today = resolve_course_ids(session, raw_dismissed) | raw_dismissed

    return played_ids, past_featured, dismissed_today


def _score_candidates(
    candidates_with_distance: list[tuple[Course, float | None]],
    preferences: OnboardingPreference | None,
    saved_course_ids: set[int],
    ratings_map: dict[int, tuple[float | None, int]],
    radius_miles: float,
) -> list[tuple[Course, float | None, float]]:
    """Scores candidate courses using deterministic weighted criteria.
    Returns sorted list of (course, distance, score) descending by score."""
    user_diff = preferences.difficulty if preferences else "any"
    scored: list[tuple[Course, float | None, float]] = []

    for course, dist in candidates_with_distance:
        comm_rating, _ = ratings_map.get(course.id, (None, 0))
        score = 0.0

        # Base community rating (0..100)
        base_rating = comm_rating if comm_rating is not None else 7.0
        score += base_rating * 10.0

        # Preferred difficulty match (+25)
        if user_diff != "any" and course.difficulty == user_diff:
            score += 25.0

        # Course in user's saved list (+30)
        if course.id in saved_course_ids:
            score += 30.0

        # Has approved hero image (+20)
        has_approved_hero = any(
            img.is_hero and img.moderation_status == CourseImageModeration.APPROVED
            for img in getattr(course, "images", [])
        )
        if has_approved_hero:
            score += 20.0
        elif getattr(course, "images", None):
            score += 10.0

        # Complete scorecard metadata (+5)
        if course.hole_count and course.par:
            score += 5.0

        # Proximity bonus (0..20)
        if dist is not None and radius_miles > 0:
            score += max(0.0, (radius_miles - dist) / radius_miles) * 20.0

        scored.append((course, dist, score))

    # Tie-break deterministically by ID descending
    scored.sort(key=lambda item: (item[2], item[0].id), reverse=True)
    return scored


def resolve_featured_candidate(
    session: Session,
    user: User,
    today: date,
    lat: float | None = None,
    lng: float | None = None,
) -> tuple[Course, float | None, bool]:
    """Deterministically resolves the best featured course candidate for this user.
    Returns (course, distance_miles, is_regional_fallback)."""
    preferences = session.get(OnboardingPreference, user.id)
    profile = session.get(Profile, user.id)
    onboarding_data = preferences.onboarding_data if preferences and preferences.onboarding_data else {}
    home_region = profile.home_region if profile else None

    # Exclusions
    played_ids, past_featured_ids, dismissed_today_ids = _get_user_exclusions(session, user.id, today)
    raw_saved = set(session.scalars(
        select(SavedCourse.course_id)
        .join(SavedList, SavedList.id == SavedCourse.list_id)
        .where(SavedList.user_id == user.id)
    ).all())
    saved_course_ids = resolve_course_ids(session, raw_saved) | raw_saved

    # Constraints
    max_green_fee = preferences.max_green_fee if preferences else None
    access_pref = preferences.access if preferences else "any"

    # Location & Radius
    anchor_lat, anchor_lng = _resolve_anchor_coordinates(session, lat, lng, home_region)
    travel_str = str(onboarding_data.get("travel_distance") or "").lower().strip()
    radius_miles = TRAVEL_RADIUS_MAP.get(travel_str, DEFAULT_RADIUS_MILES)

    def build_query(excluded: set[int], state_code: str | None = None, bbox: tuple[float, float, float, float] | None = None):
        stmt = select(Course).where(Course.status == "active", canonical_courses_only())
        if excluded:
            stmt = stmt.where(~Course.id.in_(excluded))
        if access_pref != "any":
            stmt = stmt.where(Course.is_public == (access_pref == "public"))
        if max_green_fee is not None:
            stmt = stmt.where(or_(Course.green_fee <= max_green_fee, Course.green_fee.is_(None)))
        if state_code:
            stmt = stmt.where(Course.admin1_code == state_code)
        if bbox:
            min_lat, max_lat, min_lng, max_lng = bbox
            stmt = stmt.where(
                Course.latitude.between(min_lat, max_lat),
                Course.longitude.between(min_lng, max_lng),
            )
        return stmt.order_by(Course.id)

    def fetch_ratings(course_ids: list[int]) -> dict[int, tuple[float | None, int]]:
        if not course_ids:
            return {}
        result: dict[int, tuple[float | None, int]] = {}
        chunk_size = 500
        for i in range(0, len(course_ids), chunk_size):
            chunk = course_ids[i : i + chunk_size]
            rows = session.execute(
                select(
                    UserCourseRating.course_id,
                    func.avg(UserCourseRating.rating).label("avg_rating"),
                    func.count(UserCourseRating.id).label("count_rating"),
                )
                .where(UserCourseRating.course_id.in_(chunk))
                .group_by(UserCourseRating.course_id)
            ).all()
            for r in rows:
                result[r[0]] = (float(r[1]) if r[1] is not None else None, int(r[2]))
        return result

    primary_excluded = played_ids | past_featured_ids | dismissed_today_ids
    candidates: list[tuple[Course, float | None]] = []
    is_regional_fallback = False

    # Attempt 1: Local radius search with bounding box
    if anchor_lat is not None and anchor_lng is not None:
        lat_delta = radius_miles / 69.0
        lng_delta = radius_miles / (69.0 * math.cos(math.radians(anchor_lat)) or 1.0)
        bbox = (anchor_lat - lat_delta, anchor_lat + lat_delta, anchor_lng - lng_delta, anchor_lng + lng_delta)

        rows = session.scalars(build_query(primary_excluded, bbox=bbox)).all()
        for course in rows:
            dist = miles_between(anchor_lat, anchor_lng, course)
            if dist <= radius_miles:
                candidates.append((course, dist))

    # Attempt 2: Statewide fallback (relax geographic radius only; retain access and budget constraints)
    if not candidates:
        is_regional_fallback = True
        state_code = extract_state_code(home_region) or "CA"
        rows = session.scalars(build_query(primary_excluded, state_code=state_code)).all()
        for course in rows:
            dist = miles_between(anchor_lat, anchor_lng, course) if anchor_lat and anchor_lng else None
            candidates.append((course, dist))

    # Attempt 3: Relax 14-day recency exclusion if all unplayed courses were recently shown
    if not candidates:
        relaxed_excluded = played_ids | dismissed_today_ids
        state_code = extract_state_code(home_region) or "CA"
        rows = session.scalars(build_query(relaxed_excluded, state_code=state_code)).all()
        for course in rows:
            dist = miles_between(anchor_lat, anchor_lng, course) if anchor_lat and anchor_lng else None
            candidates.append((course, dist))

    # Attempt 4: Safety fallback (any active course meeting access and budget constraints, excluding dismissed today)
    if not candidates:
        rows = session.scalars(build_query(dismissed_today_ids).limit(20)).all()
        for course in rows:
            dist = miles_between(anchor_lat, anchor_lng, course) if anchor_lat and anchor_lng else None
            candidates.append((course, dist))

    # Attempt 5: Extreme safety fallback when every course in the catalog has already been dismissed today
    if not candidates:
        rows = session.scalars(build_query(set()).limit(20)).all()
        for course in rows:
            dist = miles_between(anchor_lat, anchor_lng, course) if anchor_lat and anchor_lng else None
            candidates.append((course, dist))

    # If still no course at all (e.g. empty test db with zero courses), raise clear 404
    if not candidates:
        raise HTTPException(404, "No suitable course available in the catalog.")

    course_ids = [c[0].id for c in candidates]
    ratings_map = fetch_ratings(course_ids)
    scored = _score_candidates(candidates, preferences, saved_course_ids, ratings_map, radius_miles)

    best_course, best_distance, _ = scored[0]
    return best_course, best_distance, is_regional_fallback


async def generate_featured_narrative(
    course: Course,
    distance_miles: float | None,
    is_regional_fallback: bool,
    preferences: OnboardingPreference | None,
    saved_course_ids: set[int],
    settings: Settings,
    session: Session | None = None,
    can_use_ai: bool | None = None,
) -> tuple[str, str, list[str], str, int | None]:
    """Generates (headline, rationale, match_tags, generation_status, estimated_cost_micros).
    Uses Gemini if enabled and under monthly budget; otherwise returns high-quality deterministic copy."""
    in_saved_list = course.id in saved_course_ids
    user_data = preferences.onboarding_data if preferences and preferences.onboarding_data else {}
    walking_pref = user_data.get("transportation")
    user_diff = preferences.difficulty if preferences else "any"

    # Admission check for AI generation
    if can_use_ai is None:
        if not settings.ai_planner_enabled or not settings.gemini_api_key:
            can_use_ai = False
        elif session is None:
            can_use_ai = False
        else:
            max_cost = estimate_max_request_cost_micros(settings)
            cost_limit_micros = settings.ai_featured_course_monthly_cost_limit_cents * 10_000
            db_cost = monthly_ai_cost_micros(session, DailyFeaturedCourse, DailyFeaturedCourse.estimated_cost_micros)
            can_use_ai = (db_cost + max_cost) <= cost_limit_micros

    if can_use_ai:
        candidate_facts = {
            "course_name": course.name,
            "region": course.region,
            "city": course.city,
            "green_fee": course.green_fee,
            "difficulty": course.difficulty,
            "is_public": course.is_public,
            "hole_count": course.hole_count,
            "distance_miles": round(distance_miles, 1) if distance_miles is not None else None,
            "in_saved_list": in_saved_list,
            "is_regional_fallback": is_regional_fallback,
            "user_preferences": {
                "preferred_difficulty": user_diff,
            },
        }
        schema = {
            "type": "object",
            "properties": {
                "headline": {"type": "string", "maxLength": 120},
                "rationale": {"type": "string", "maxLength": 500},
                "match_tags": {
                    "type": "array",
                    "items": {"type": "string", "maxLength": 40},
                    "minItems": 1,
                    "maxItems": 4,
                },
            },
            "required": ["headline", "rationale", "match_tags"],
            "additionalProperties": False,
        }
        payload = {
            "systemInstruction": {
                "parts": [{
                    "text": (
                        "You write a concise, compelling 1-2 sentence recommendation for this week's featured golf course. "
                        "Ground all rationale strictly in the provided course facts. Never invent prices, tee times, "
                        "amenities, or course policies. Keep tags short (under 4 words each)."
                    )
                }]
            },
            "contents": [{
                "role": "user",
                "parts": [{"text": json.dumps(candidate_facts, separators=(",", ":"))}],
            }],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": schema,
                "maxOutputTokens": 300,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=settings.ai_planner_timeout_seconds) as client:
                res = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{settings.ai_planner_model}:generateContent",
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json=payload,
                )
                res.raise_for_status()
                data = res.json()
                text_part = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = NarrativeSchema.model_validate_json(text_part)

                usage = data.get("usageMetadata", {})
                in_tok = usage.get("promptTokenCount", 0)
                out_tok = usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
                cost_micros = (
                    in_tok * settings.ai_planner_input_cost_micros_per_million_tokens
                    + out_tok * settings.ai_planner_output_cost_micros_per_million_tokens
                ) // 1_000_000

                return parsed.headline, parsed.rationale, parsed.match_tags, "ai_generated", cost_micros
        except Exception as error:
            logger.warning("featured_course_ai_fallback reason=%s", type(error).__name__)

    # Deterministic fallback template grounded in real facts
    if is_regional_fallback:
        headline = "Regional Course Spotlight"
    elif in_saved_list:
        headline = "From Your Saved List"
    else:
        headline = "This Week's Course Spotlight"

    descriptors: list[str] = []
    if course.difficulty:
        descriptors.append(course.difficulty.lower())
    if course.is_public is not None:
        descriptors.append("public" if course.is_public else "private")

    region_str = f" in {course.region}" if course.region else (f" in {course.city}" if course.city else "")
    if descriptors:
        desc_text = " ".join(descriptors)
        article = "an" if desc_text[0].lower() in "aeiou" else "a"
        main_sentence = f"{course.name} is {article} {desc_text} course{region_str}."
    else:
        main_sentence = f"{course.name} is a golf course{region_str}."

    rationale_parts = [main_sentence]
    if in_saved_list:
        rationale_parts.append("A featured pick from your saved list.")
    if course.green_fee:
        rationale_parts.append(f"Green fees start around ${course.green_fee}.")
    rationale = " ".join(rationale_parts)

    tags: list[str] = []
    if distance_miles is not None:
        tags.append(f"~{round(distance_miles)} mi away")
    if course.green_fee:
        tags.append(f"${course.green_fee} Fee")
    elif course.is_public is not None:
        tags.append("Public Access" if course.is_public else "Private Club")
    if course.difficulty:
        tags.append(course.difficulty.title())
    if in_saved_list:
        tags.append("Saved List")
    elif not tags:
        tags.append("Featured")

    return headline, rationale, tags[:4], "fallback_template", 0


def _build_featured_response(
    session: Session,
    featured: DailyFeaturedCourse,
    user_id: int,
    lat: float | None = None,
    lng: float | None = None,
) -> FeaturedCourseOut:
    course = featured.course
    # Live distance re-calculation from live lat/lng
    live_dist: float | None = None
    if lat is not None and lng is not None:
        live_dist = round(miles_between(lat, lng, course), 1)

    # Check is_saved across canonical course and all reconciled aliases
    identities = course_identity_ids(session, course)
    is_saved = session.scalar(
        select(SavedCourse.id)
        .join(SavedList, SavedList.id == SavedCourse.list_id)
        .where(SavedList.user_id == user_id, SavedCourse.course_id.in_(identities))
        .limit(1)
    ) is not None

    # Load course community rating
    rating_row = session.execute(
        select(func.avg(UserCourseRating.rating), func.count(UserCourseRating.id))
        .where(UserCourseRating.course_id == course.id)
    ).first()
    comm_rating = float(rating_row[0]) if rating_row and rating_row[0] is not None else None
    rating_count = int(rating_row[1]) if rating_row and rating_row[1] is not None else 0

    c_data = course_data(course)
    c_data["community_rating"] = comm_rating
    c_data["rating_count"] = rating_count
    c_data["distance_miles"] = live_dist
    course_out = CourseOut.model_validate(c_data)

    return FeaturedCourseOut(
        id=featured.id,
        recommendation_date=featured.recommendation_date,
        sequence=featured.sequence,
        headline=featured.headline,
        rationale=featured.rationale,
        match_tags=featured.match_tags,
        is_regional_fallback=featured.is_regional_fallback,
        course=course_out,
        distance_miles=live_dist,
        is_saved=is_saved,
        can_dismiss=featured.sequence < (MAX_DISMISSALS_PER_DAY + 1),
    )


@router.get("", response_model=FeaturedCourseOut, dependencies=[Depends(authenticated_rate_limit)])
async def get_featured_course(
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    session: Session = Depends(get_session),
    current: CurrentUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> FeaturedCourseOut:
    user = require_user(session, current)
    target_date = current_week_anchor()

    active = session.scalar(
        select(DailyFeaturedCourse).where(
            DailyFeaturedCourse.user_id == user.id,
            DailyFeaturedCourse.recommendation_date == target_date,
            DailyFeaturedCourse.dismissed.is_(False),
        )
    )

    if active is not None:
        logger.info(
            "featured_course_served user_id=%s course_id=%s date=%s sequence=%s status=cached generation_status=%s",
            user.id, active.course_id, target_date, active.sequence, active.generation_status,
        )
        return _build_featured_response(session, active, user.id, lat, lng)

    user_lock = await _get_user_week_lock(user.id, target_date)
    async with user_lock:
        active = session.scalar(
            select(DailyFeaturedCourse).where(
                DailyFeaturedCourse.user_id == user.id,
                DailyFeaturedCourse.recommendation_date == target_date,
                DailyFeaturedCourse.dismissed.is_(False),
            )
        )
        if active is not None:
            logger.info(
                "featured_course_served user_id=%s course_id=%s date=%s sequence=%s status=cached generation_status=%s",
                user.id, active.course_id, target_date, active.sequence, active.generation_status,
            )
            return _build_featured_response(session, active, user.id, lat, lng)

        # Lazy on-read generation
        start_time = time.perf_counter()
        course, dist, is_regional = resolve_featured_candidate(session, user, target_date, lat, lng)
        prefs = session.get(OnboardingPreference, user.id)
        raw_saved_ids = set(session.scalars(
            select(SavedCourse.course_id)
            .join(SavedList, SavedList.id == SavedCourse.list_id)
            .where(SavedList.user_id == user.id)
        ).all())
        saved_ids = resolve_course_ids(session, raw_saved_ids) | raw_saved_ids

        with budget_tracker.reserve(session, settings) as can_use_ai:
            headline, rationale, tags, gen_status, cost_micros = await generate_featured_narrative(
                course=course,
                distance_miles=dist,
                is_regional_fallback=is_regional,
                preferences=prefs,
                saved_course_ids=saved_ids,
                settings=settings,
                session=session,
                can_use_ai=can_use_ai,
            )

            featured = DailyFeaturedCourse(
                user_id=user.id,
                course_id=course.id,
                recommendation_date=target_date,
                sequence=1,
                dismissed=False,
                headline=headline,
                rationale=rationale,
                match_tags=tags,
                is_regional_fallback=is_regional,
                generation_status=gen_status,
                estimated_cost_micros=cost_micros,
            )
            session.add(featured)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                # If a race occurred and another request generated the active row first, preserve spent cost and return it
                active = session.scalar(
                    select(DailyFeaturedCourse).where(
                        DailyFeaturedCourse.user_id == user.id,
                        DailyFeaturedCourse.recommendation_date == target_date,
                        DailyFeaturedCourse.dismissed.is_(False),
                    )
                )
                if active is not None:
                    if cost_micros and cost_micros > 0:
                        try:
                            active.estimated_cost_micros = (active.estimated_cost_micros or 0) + cost_micros
                            session.commit()
                        except Exception:
                            session.rollback()
                    return _build_featured_response(session, active, user.id, lat, lng)
                raise

        latency_ms = round((time.perf_counter() - start_time) * 1000)
        logger.info(
            "featured_course_served user_id=%s course_id=%s date=%s sequence=1 status=generated generation_status=%s latency_ms=%s cost_micros=%s",
            user.id, course.id, target_date, gen_status, latency_ms, cost_micros,
        )
        return _build_featured_response(session, featured, user.id, lat, lng)


@router.post("/dismiss", response_model=FeaturedCourseOut, dependencies=[Depends(authenticated_rate_limit)])
async def dismiss_featured_course(
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    session: Session = Depends(get_session),
    current: CurrentUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> FeaturedCourseOut:
    user = require_user(session, current)
    target_date = current_week_anchor()

    # Wrap dismiss in atomic row-locking transaction
    active_stmt = (
        select(DailyFeaturedCourse)
        .where(
            DailyFeaturedCourse.user_id == user.id,
            DailyFeaturedCourse.recommendation_date == target_date,
            DailyFeaturedCourse.dismissed.is_(False),
        )
    )
    if session.bind and session.bind.dialect.name != "sqlite":
        active_stmt = active_stmt.with_for_update()

    active = session.scalar(active_stmt)
    if active is None:
        raise HTTPException(404, "No active featured course to dismiss.")

    if active.sequence >= (MAX_DISMISSALS_PER_DAY + 1):
        logger.info("featured_course_quota_exhausted user_id=%s date=%s", user.id, target_date)
        raise HTTPException(400, "Weekly recommendation refresh limit reached.")

    old_course_id = active.course_id
    active.dismissed = True
    next_sequence = active.sequence + 1
    session.flush()

    # Generate runner-up candidate
    course, dist, is_regional = resolve_featured_candidate(session, user, target_date, lat, lng)
    prefs = session.get(OnboardingPreference, user.id)
    raw_saved_ids = set(session.scalars(
        select(SavedCourse.course_id)
        .join(SavedList, SavedList.id == SavedCourse.list_id)
        .where(SavedList.user_id == user.id)
    ).all())
    saved_ids = resolve_course_ids(session, raw_saved_ids) | raw_saved_ids

    with budget_tracker.reserve(session, settings) as can_use_ai:
        headline, rationale, tags, gen_status, cost_micros = await generate_featured_narrative(
            course=course,
            distance_miles=dist,
            is_regional_fallback=is_regional,
            preferences=prefs,
            saved_course_ids=saved_ids,
            settings=settings,
            session=session,
            can_use_ai=can_use_ai,
        )

        next_featured = DailyFeaturedCourse(
            user_id=user.id,
            course_id=course.id,
            recommendation_date=target_date,
            sequence=next_sequence,
            dismissed=False,
            headline=headline,
            rationale=rationale,
            match_tags=tags,
            is_regional_fallback=is_regional,
            generation_status=gen_status,
            estimated_cost_micros=cost_micros,
        )
        session.add(next_featured)

        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            if cost_micros and cost_micros > 0:
                try:
                    active_row = session.scalar(
                        select(DailyFeaturedCourse).where(
                            DailyFeaturedCourse.user_id == user.id,
                            DailyFeaturedCourse.recommendation_date == target_date,
                            DailyFeaturedCourse.dismissed.is_(False),
                        )
                    )
                    if active_row:
                        active_row.estimated_cost_micros = (active_row.estimated_cost_micros or 0) + cost_micros
                        session.commit()
                except Exception:
                    session.rollback()
            raise HTTPException(409, "A concurrent recommendation refresh is in progress. Please retry.")

    logger.info(
        "featured_course_dismissed user_id=%s old_course_id=%s new_course_id=%s sequence=%s",
        user.id, old_course_id, course.id, next_sequence,
    )
    return _build_featured_response(session, next_featured, user.id, lat, lng)


@router.post("/save", dependencies=[Depends(authenticated_rate_limit)])
def save_featured_course(
    session: Session = Depends(get_session),
    current: CurrentUser = Depends(current_user),
) -> dict[str, Any]:
    user = require_user(session, current)
    target_date = current_week_anchor()

    active = session.scalar(
        select(DailyFeaturedCourse).where(
            DailyFeaturedCourse.user_id == user.id,
            DailyFeaturedCourse.recommendation_date == target_date,
            DailyFeaturedCourse.dismissed.is_(False),
        )
    )
    if active is None:
        raise HTTPException(404, "No active featured course to save.")

    try:
        saved, is_new = save_course_to_default_list(session, user.id, active.course)
        session.commit()
    except IntegrityError:
        session.rollback()
        saved, is_new = save_course_to_default_list(session, user.id, active.course)
        session.commit()
    return {"status": "saved", "course_id": active.course_id, "is_new": is_new}
