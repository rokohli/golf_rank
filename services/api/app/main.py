import logging
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.config import Settings
from .catalog import miles_between, router as catalog_router
from .course_ratings import router as course_ratings_router
from .db import get_session, make_engine, make_session_factory
from .domain import course_data
from .models import Base, Course, OnboardingPreference, Profile, User, UserCourseRating
from .plans import router as plans_router
from .ranking import router as ranking_router
from .rounds import course_state_router, router as rounds_router
from .saves import router as saves_router
from .schemas import CourseOut, OnboardingPreferencesIn, ProfileOut
from .seed import seed_courses
from .social import router as social_router


logger = logging.getLogger("golfrank.catalog")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate_security()

    app = FastAPI(title="GolfRank API")
    engine = make_engine(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.include_router(ranking_router)
    app.include_router(course_ratings_router)
    app.include_router(rounds_router)
    app.include_router(course_state_router)
    app.include_router(social_router)
    app.include_router(catalog_router)
    app.include_router(saves_router)
    app.include_router(plans_router)

    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
        with app.state.session_factory() as session:
            seed_courses(session)

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.headers.get(
            "X-Request-ID", str(uuid4())
        )
        return response

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.put("/api/v1/me/onboarding-preferences", response_model=ProfileOut)
    def save_preferences(
        payload: OnboardingPreferencesIn,
        user: CurrentUser = Depends(current_user),
        session: Session = Depends(get_session),
    ) -> ProfileOut:
        stored_user = session.scalar(select(User).where(User.provider_subject == user.provider_subject))
        if stored_user is None:
            stored_user = User(provider_subject=user.provider_subject)
            session.add(stored_user)
            session.flush()
        profile = session.get(Profile, stored_user.id) or Profile(user_id=stored_user.id, home_region=payload.home_region)
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
            preferences.onboarding_data = (
                payload.onboarding_data.model_dump() if payload.onboarding_data else None
            )
        session.add_all([profile, preferences])
        session.commit()
        return ProfileOut(
            home_region=profile.home_region,
            max_green_fee=preferences.max_green_fee,
            difficulty=preferences.difficulty,
            access=preferences.access,
            onboarding_data=preferences.onboarding_data,
        )

    @app.get("/api/v1/me/profile", response_model=ProfileOut)
    def profile(
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
        limit: int = 50,
        max_green_fee: int | None = None,
        difficulty: str = "any",
        access: str = "any",
        session: Session = Depends(get_session),
    ) -> list[dict]:
        if (lat is None) != (lng is None):
            raise HTTPException(422, "lat and lng must be provided together")
        if radius_miles is not None and (lat is None or lng is None):
            raise HTTPException(422, "radius_miles requires lat and lng")
        if not 1 <= limit <= 100:
            raise HTTPException(422, "limit must be between 1 and 100")
        statement = (
            select(
                Course,
                func.avg(UserCourseRating.rating).label("community_rating"),
                func.count(UserCourseRating.id).label("rating_count"),
            )
            .outerjoin(UserCourseRating, UserCourseRating.course_id == Course.id)
            .where(Course.status == "active")
            .group_by(Course.id)
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
            statement = statement.where(or_(Course.region.ilike(f"%{region}%"), Course.city.ilike(f"%{region}%")))
        if country:
            statement = statement.where(Course.country_code == country.upper())
        if admin1:
            statement = statement.where(or_(Course.admin1_code == admin1.upper(), Course.admin1_name.ilike(admin1)))
        if city:
            statement = statement.where(Course.city.ilike(city))
        if cursor is not None:
            statement = statement.where(Course.id > cursor)
        if max_green_fee is not None:
            statement = statement.where(Course.green_fee <= max_green_fee)
        if difficulty != "any":
            statement = statement.where(Course.difficulty == difficulty)
        if access != "any":
            statement = statement.where(Course.is_public == (access == "public"))
        rows = session.execute(
            statement.order_by(Course.id) if lat is not None else statement.order_by(Course.id).limit(limit)
        ).all()
        if lat is not None and lng is not None:
            maximum = radius_miles if radius_miles is not None else 50
            rows = [row for row in rows if miles_between(lat, lng, row[0]) <= maximum][:limit]
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
                "rating_count": int(rating_count),
            }
            for stored_course, community_rating, rating_count in rows
        ]

    @app.get("/api/v1/courses/{course_id}", response_model=CourseOut)
    def course(course_id: int, session: Session = Depends(get_session)) -> dict:
        stored_course = session.get(Course, course_id)
        if stored_course is None:
            raise HTTPException(404, "Course not found")
        community_rating, rating_count = session.execute(
            select(func.avg(UserCourseRating.rating), func.count(UserCourseRating.id)).where(
                UserCourseRating.course_id == course_id
            )
        ).one()
        return {
            **course_data(stored_course),
            "community_rating": (
                round(float(community_rating), 1)
                if community_rating is not None
                else None
            ),
            "rating_count": int(rating_count),
        }

    return app


app = create_app()
