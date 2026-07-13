from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.config import Settings
from .db import get_session, make_engine, make_session_factory
from .models import Base, Course, OnboardingPreference, Profile, User
from .plans import router as plans_router
from .ranking import router as ranking_router
from .rounds import course_state_router, router as rounds_router
from .saves import router as saves_router
from .schemas import CourseOut, OnboardingPreferencesIn, ProfileOut
from .seed import seed_courses
from .social import router as social_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate_security()

    app = FastAPI(title="GolfRank API")
    engine = make_engine(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.include_router(ranking_router)
    app.include_router(rounds_router)
    app.include_router(course_state_router)
    app.include_router(social_router)
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
        max_green_fee: int | None = None,
        difficulty: str = "any",
        access: str = "any",
        session: Session = Depends(get_session),
    ) -> list[Course]:
        statement = select(Course)
        if q:
            statement = statement.where(Course.name.ilike(f"%{q}%"))
        if region:
            statement = statement.where(Course.region == region)
        if max_green_fee is not None:
            statement = statement.where(Course.green_fee <= max_green_fee)
        if difficulty != "any":
            statement = statement.where(Course.difficulty == difficulty)
        if access != "any":
            statement = statement.where(Course.is_public == (access == "public"))
        return list(session.scalars(statement.order_by(Course.name)).all())

    return app


app = create_app()
