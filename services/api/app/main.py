import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Lock

from fastapi import Depends, FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, aliased
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .core.auth import CurrentUser, current_user, delete_clerk_user
from .core.config import Settings
from .core.http_security import RequestBodyLimitMiddleware, SecurityHeadersMiddleware
from .core.rate_limit import (
    RateLimiter,
    authenticated_rate_limit,
    public_rate_limit,
    readiness_rate_limit,
)
from .catalog import miles_between, router as catalog_router
from .course_images.service import CourseImageService
from .course_ratings import router as course_ratings_router
from .db import get_session, make_engine, make_session_factory
from .domain import (
    canonical_courses_only,
    course_data,
    course_identity_ids,
    lock_identity_transaction,
    require_course,
    require_user,
)
from .models import (
    Base,
    Course,
    CourseReconciliation,
    ActivityEvent,
    ActivityReaction,
    AppNotification,
    Comparison,
    CourseCandidate,
    DeletedIdentity,
    Follow,
    ItineraryItem,
    LinkedContact,
    OnboardingPreference,
    Plan,
    PlanCandidate,
    PlanConstraint,
    PlanGeneration,
    Profile,
    RankingConfidence,
    RankingSnapshot,
    Round,
    RoundCompanion,
    RoundNote,
    SavedCourse,
    SavedList,
    TierAssignment,
    User,
    UserBlock,
    UserCourseRating,
    UserCourseState,
    UserMute,
)
from .plans import router as plans_router
from .planner_narrative import build_planner_narrative_provider
from .ranking import router as ranking_router
from .rounds import course_state_router, router as rounds_router
from .saves import router as saves_router
from .schemas import CourseOut, OnboardingPreferencesIn, ProfileOut, normalize_username
from .seed import seed_test_courses
from .social import notify_linked_contacts, router as social_router


logger = logging.getLogger("golfrank.catalog")


def _row_data(row: object) -> dict:
    table = row.__table__
    return {column.name: getattr(row, column.name) for column in table.columns}


def _assign_unique_username(session: Session, profile: Profile, user_id: int, username: str) -> None:
    owner_id = session.scalar(select(Profile.user_id).where(Profile.username == username))
    if owner_id is not None and owner_id != user_id:
        raise HTTPException(409, "That username is already taken.")
    profile.username = username


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate_security()
    rate_limiter = RateLimiter(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        await rate_limiter.close()

    development = settings.app_env == "development"
    app = FastAPI(
        title="GolfRank API",
        docs_url="/docs" if development else None,
        redoc_url="/redoc" if development else None,
        openapi_url="/openapi.json" if development else None,
        lifespan=lifespan,
    )
    engine = make_engine(
        settings.database_url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
    )
    app.state.engine = engine
    app.state.settings = settings
    app.state.rate_limiter = rate_limiter
    app.state.planner_narrative_provider = build_planner_narrative_provider(settings)
    app.state.course_image_service = CourseImageService(settings=settings)
    app.state.session_factory = make_session_factory(
        engine, course_image_base_url=settings.course_image_base_url
    )
    authenticated_dependencies = [Depends(authenticated_rate_limit)]
    app.include_router(ranking_router, dependencies=authenticated_dependencies)
    app.include_router(course_ratings_router, dependencies=authenticated_dependencies)
    app.include_router(rounds_router, dependencies=authenticated_dependencies)
    app.include_router(course_state_router, dependencies=authenticated_dependencies)
    app.include_router(social_router, dependencies=authenticated_dependencies)
    app.include_router(catalog_router)
    app.include_router(saves_router, dependencies=authenticated_dependencies)
    app.include_router(plans_router, dependencies=authenticated_dependencies)

    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_bytes=settings.max_request_body_bytes,
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.allowed_host_list,
    )
    app.add_middleware(
        SecurityHeadersMiddleware,
        production=not development,
    )
    readiness_lock = Lock()
    readiness_cache: dict[str, float | bool] = {
        "expires_at": 0.0,
        "ready": False,
    }

    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
        with app.state.session_factory() as session:
            seed_test_courses(session)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    def ready(_rate_limit: None = Depends(readiness_rate_limit)) -> dict[str, str]:
        now = time.monotonic()
        with readiness_lock:
            if readiness_cache["expires_at"] <= now:
                try:
                    with app.state.session_factory() as session:
                        session.execute(text("SELECT 1"))
                except SQLAlchemyError as error:
                    logger.exception("Database readiness check failed")
                    readiness_cache.update(
                        expires_at=now + min(1.0, settings.readiness_cache_seconds),
                        ready=False,
                    )
                    raise HTTPException(503, "Database unavailable") from error
                readiness_cache.update(
                    expires_at=now + settings.readiness_cache_seconds,
                    ready=True,
                )
            if not readiness_cache["ready"]:
                raise HTTPException(503, "Database unavailable")
        return {"status": "ready"}

    @app.put("/api/v1/me/onboarding-preferences", response_model=ProfileOut)
    def save_preferences(
        payload: OnboardingPreferencesIn,
        _rate_limit: None = Depends(authenticated_rate_limit),
        user: CurrentUser = Depends(current_user),
        session: Session = Depends(get_session),
    ) -> ProfileOut:
        stored_user = require_user(session, user, create=True)
        profile = session.get(Profile, stored_user.id)
        if profile is None:
            profile = Profile(user_id=stored_user.id, home_region=payload.home_region)
        preferences = session.get(OnboardingPreference, stored_user.id) or OnboardingPreference(
            user_id=stored_user.id,
            max_green_fee=payload.max_green_fee,
            difficulty=payload.difficulty,
            access=payload.access,
        )
        profile.home_region = payload.home_region
        preferences.max_green_fee = payload.max_green_fee
        preferences.difficulty = payload.difficulty
        preferences.access = payload.access
        if "onboarding_data" in payload.model_fields_set:
            onboarding_data = payload.onboarding_data.model_dump() if payload.onboarding_data else None
            if onboarding_data is not None:
                _assign_unique_username(session, profile, stored_user.id, onboarding_data["username"])
            preferences.onboarding_data = onboarding_data
        session.add_all([profile, preferences])
        try:
            session.flush()
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(409, "That username is already taken.") from error
        if preferences.onboarding_data:
            from .ranking import seed_onboarding_rankings

            seed_onboarding_rankings(session, stored_user.id, preferences.onboarding_data)
        try:
            # Re-attempt on every authenticated preferences save so a transient
            # Clerk outage during first onboarding cannot suppress this optional
            # notification forever. Matching is idempotent.
            notify_linked_contacts(session, stored_user, user, settings)
        except HTTPException as error:
            logger.warning("contact_join_matching_skipped user_id=%s status=%s", stored_user.id, error.status_code)
        session.commit()
        return ProfileOut(
            home_region=profile.home_region,
            max_green_fee=preferences.max_green_fee,
            difficulty=preferences.difficulty,
            access=preferences.access,
            onboarding_data=preferences.onboarding_data,
        )

    @app.get("/api/v1/usernames/available")
    def username_available(
        username: str,
        _rate_limit: None = Depends(authenticated_rate_limit),
        user: CurrentUser = Depends(current_user),
        session: Session = Depends(get_session),
    ) -> dict[str, bool | str]:
        try:
            normalized = normalize_username(username)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        stored_user = session.scalar(select(User).where(User.provider_subject == user.provider_subject))
        owner_id = session.scalar(
            select(Profile.user_id).where(Profile.username == normalized)
        )
        available = owner_id is None or (stored_user is not None and owner_id == stored_user.id)
        return {"available": available, "username": normalized}

    @app.get("/api/v1/me/profile", response_model=ProfileOut)
    def profile(
        _rate_limit: None = Depends(authenticated_rate_limit),
        user: CurrentUser = Depends(current_user),
        session: Session = Depends(get_session),
    ) -> ProfileOut:
        stored_user = session.scalar(select(User).where(User.provider_subject == user.provider_subject))
        if stored_user is None:
            raise HTTPException(404, "Profile not found")
        stored_profile = session.get(Profile, stored_user.id)
        preferences = session.get(OnboardingPreference, stored_user.id)
        if stored_profile is None or preferences is None:
            raise HTTPException(404, "Profile not found")
        return ProfileOut(
            home_region=stored_profile.home_region,
            max_green_fee=preferences.max_green_fee,
            difficulty=preferences.difficulty,
            access=preferences.access,
            onboarding_data=preferences.onboarding_data,
        )

    @app.get("/api/v1/me/data-export")
    def data_export(
        _rate_limit: None = Depends(authenticated_rate_limit),
        user: CurrentUser = Depends(current_user),
        session: Session = Depends(get_session),
    ) -> JSONResponse:
        stored_user = session.scalar(select(User).where(User.provider_subject == user.provider_subject))
        if stored_user is None:
            raise HTTPException(404, "Profile not found")
        profile = session.get(Profile, stored_user.id)
        preferences = session.get(OnboardingPreference, stored_user.id)
        if profile is None or preferences is None:
            raise HTTPException(404, "Profile not found")

        def rows(model, *conditions):
            return [_row_data(item) for item in session.scalars(select(model).where(*conditions)).all()]

        round_rows = session.scalars(select(Round).where(Round.user_id == stored_user.id)).all()
        round_ids = [round_.id for round_ in round_rows]
        saved_lists = session.scalars(select(SavedList).where(SavedList.user_id == stored_user.id)).all()
        saved_list_ids = [saved_list.id for saved_list in saved_lists]
        plans = session.scalars(select(Plan).where(Plan.user_id == stored_user.id)).all()
        plan_ids = [plan.id for plan in plans]
        data = {
            "export_version": 1,
            "generated_at": datetime.now(timezone.utc),
            "scope": "GolfRank application data only; Clerk identity and security data are not included.",
            "profile": {
                "home_region": profile.home_region,
                "max_green_fee": preferences.max_green_fee,
                "difficulty": preferences.difficulty,
                "access": preferences.access,
                "onboarding_data": preferences.onboarding_data,
            },
            "tier_assignments": rows(TierAssignment, TierAssignment.user_id == stored_user.id),
            "comparisons": rows(Comparison, Comparison.user_id == stored_user.id),
            "ranking_confidences": rows(RankingConfidence, RankingConfidence.user_id == stored_user.id),
            "ranking_snapshots": rows(RankingSnapshot, RankingSnapshot.user_id == stored_user.id),
            "rounds": [_row_data(round_) for round_ in round_rows],
            "round_notes": rows(RoundNote, RoundNote.round_id.in_(round_ids)) if round_ids else [],
            "round_companions": rows(RoundCompanion, RoundCompanion.round_id.in_(round_ids)) if round_ids else [],
            "course_ratings": rows(UserCourseRating, UserCourseRating.user_id == stored_user.id),
            "course_states": rows(UserCourseState, UserCourseState.user_id == stored_user.id),
            "following": rows(Follow, Follow.follower_id == stored_user.id),
            "followers": rows(Follow, Follow.followed_id == stored_user.id),
            "blocked_accounts": rows(UserBlock, UserBlock.blocker_id == stored_user.id),
            "muted_accounts": rows(UserMute, UserMute.muter_id == stored_user.id),
            "activity": rows(ActivityEvent, ActivityEvent.actor_user_id == stored_user.id),
            "activity_reactions": rows(ActivityReaction, ActivityReaction.user_id == stored_user.id),
            "linked_contacts": rows(LinkedContact, LinkedContact.user_id == stored_user.id),
            "notifications": rows(
                AppNotification,
                AppNotification.recipient_user_id == stored_user.id,
            ),
            "course_candidates": rows(CourseCandidate, CourseCandidate.submitted_by_user_id == stored_user.id),
            "saved_lists": [_row_data(saved_list) for saved_list in saved_lists],
            "saved_courses": rows(SavedCourse, SavedCourse.list_id.in_(saved_list_ids)) if saved_list_ids else [],
            "plans": [_row_data(plan) for plan in plans],
            "plan_constraints": rows(PlanConstraint, PlanConstraint.plan_id.in_(plan_ids)) if plan_ids else [],
            "plan_candidates": rows(PlanCandidate, PlanCandidate.plan_id.in_(plan_ids)) if plan_ids else [],
            "itinerary_items": rows(ItineraryItem, ItineraryItem.plan_id.in_(plan_ids)) if plan_ids else [],
            "plan_generations": rows(PlanGeneration, PlanGeneration.plan_id.in_(plan_ids)) if plan_ids else [],
        }
        return JSONResponse(
            content=jsonable_encoder(data),
            headers={"Content-Disposition": 'attachment; filename="golfrank-data-export.json"'},
        )

    @app.delete("/api/v1/me")
    def delete_account(
        _rate_limit: None = Depends(authenticated_rate_limit),
        user: CurrentUser = Depends(current_user),
        session: Session = Depends(get_session),
    ) -> JSONResponse:
        lock_identity_transaction(session, user.provider_subject)
        stored_user = session.scalar(select(User).where(User.provider_subject == user.provider_subject))
        if session.get(DeletedIdentity, user.provider_subject) is None:
            session.add(DeletedIdentity(provider_subject=user.provider_subject))
        if stored_user is not None:
            # Deleting the user row cascades to every table that references it
            # (profiles, rounds, rankings, follows, saved lists, plans, ...).
            session.delete(stored_user)
        session.commit()
        try:
            delete_clerk_user(user.provider_subject, settings)
        except HTTPException as error:
            logger.error(
                "clerk_account_deletion_failed provider_subject=%s status=%s",
                user.provider_subject, error.status_code,
            )
            return JSONResponse(content={"status": "deletion_pending"}, status_code=202)
        return JSONResponse(content={"status": "deleted"})

    @app.get("/api/v1/courses", response_model=list[CourseOut])
    def courses(
        q: str | None = None,
        region: str | None = None,
        country: str | None = None,
        admin1: str | None = None,
        city: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
        radius_miles: float | None = None,
        cursor: int | None = None,
        offset: int = 0,
        limit: int = 50,
        max_green_fee: int | None = None,
        difficulty: str = "any",
        access: str = "any",
        _rate_limit: None = Depends(public_rate_limit),
        session: Session = Depends(get_session),
    ) -> list[dict]:
        if (lat is None) != (lng is None):
            raise HTTPException(422, "lat and lng must be provided together")
        if radius_miles is not None and (lat is None or lng is None):
            raise HTTPException(422, "radius_miles requires lat and lng")
        if not 1 <= limit <= 100:
            raise HTTPException(422, "limit must be between 1 and 100")
        if offset < 0:
            raise HTTPException(422, "offset must be non-negative")
        rated_course = aliased(Course)
        canonical_rating_id = func.coalesce(
            CourseReconciliation.canonical_course_id,
            UserCourseRating.course_id,
        )
        rating_aggregates = (
            select(
                canonical_rating_id.label("course_id"),
                func.avg(UserCourseRating.rating).label("community_rating"),
                func.count(UserCourseRating.id).label("rating_count"),
            )
            .select_from(UserCourseRating)
            .join(rated_course, rated_course.id == UserCourseRating.course_id)
            .outerjoin(
                CourseReconciliation,
                and_(
                    CourseReconciliation.source == rated_course.source,
                    CourseReconciliation.source_course_id == rated_course.source_course_id,
                    CourseReconciliation.match_status == "confirmed",
                ),
            )
            .group_by(canonical_rating_id)
            .subquery()
        )
        statement = (
            select(
                Course,
                rating_aggregates.c.community_rating,
                rating_aggregates.c.rating_count,
            )
            .outerjoin(rating_aggregates, rating_aggregates.c.course_id == Course.id)
            .where(Course.status == "active", canonical_courses_only())
        )
        if q:
            needle = f"%{q}%"
            statement = statement.where(or_(
                Course.name.ilike(needle),
                Course.course_name.ilike(needle),
                Course.facility_name.ilike(needle),
                Course.city.ilike(needle),
                Course.region.ilike(needle),
            ))
        if region:
            statement = statement.where(or_(
                Course.region.ilike(f"%{region}%"),
                Course.city.ilike(f"%{region}%"),
                Course.admin1_code.ilike(region),
                Course.admin1_name.ilike(f"%{region}%"),
            ))
        if country:
            statement = statement.where(Course.country_code == country.upper())
        if admin1:
            statement = statement.where(or_(Course.admin1_code == admin1.upper(), Course.admin1_name.ilike(admin1)))
        if city:
            statement = statement.where(Course.city.ilike(city))
        if cursor is not None and lat is None:
            statement = statement.where(Course.id > cursor)
        if max_green_fee is not None:
            statement = statement.where(Course.green_fee <= max_green_fee)
        if difficulty != "any":
            # Provider catalogs do not yet have complete difficulty metadata.
            # Keep unknown courses discoverable while still excluding a known mismatch.
            statement = statement.where(or_(Course.difficulty == difficulty, Course.difficulty.is_(None)))
        if access != "any":
            statement = statement.where(Course.is_public == (access == "public"))
        rows = session.execute(
            statement.order_by(Course.id) if lat is not None else statement.order_by(Course.id).offset(offset).limit(limit)
        ).all()
        distances: dict[int, float] = {}
        if lat is not None and lng is not None:
            maximum = radius_miles if radius_miles is not None else 50
            measured = [
                (row, miles_between(lat, lng, row[0]))
                for row in rows
                if row[0].latitude is not None and row[0].longitude is not None
            ]
            measured = [item for item in measured if item[1] <= maximum]
            measured.sort(key=lambda item: (item[1], item[0][0].id))
            page = measured[offset:offset + limit]
            rows = [item[0] for item in page]
            distances = {item[0][0].id: item[1] for item in page}
        logger.info(
            "course_search result_count=%s q=%r country=%r admin1=%r city=%r region=%r "
            "radius_miles=%r access=%r difficulty=%r max_green_fee=%r",
            len(rows), q, country, admin1, city, region, radius_miles, access, difficulty,
            max_green_fee,
        )
        return [
            {
                **course_data(stored_course),
                "community_rating": (
                    round(float(community_rating), 1)
                    if community_rating is not None
                    else None
                ),
                "rating_count": int(rating_count or 0),
                "distance_miles": (
                    round(distances[stored_course.id], 1)
                    if stored_course.id in distances
                    else None
                ),
            }
            for stored_course, community_rating, rating_count in rows
        ]

    @app.get("/api/v1/courses/{course_id}", response_model=CourseOut)
    def course(
        course_id: int,
        _rate_limit: None = Depends(public_rate_limit),
        session: Session = Depends(get_session),
    ) -> dict:
        stored_course = require_course(session, course_id)
        canonical_id = stored_course.id
        identity_ids = course_identity_ids(session, stored_course)
        community_rating, rating_count = session.execute(
            select(func.avg(UserCourseRating.rating), func.count(UserCourseRating.id)).where(
                UserCourseRating.course_id.in_(identity_ids)
            )
        ).one()
        hero_image = app.state.course_image_service.resolve_hero_image(session, stored_course)
        return {
            **course_data(stored_course),
            "hero_image": hero_image.to_dict(),
            "community_rating": (
                round(float(community_rating), 1)
                if community_rating is not None
                else None
            ),
            "rating_count": int(rating_count),
        }

    return app

app = create_app()
