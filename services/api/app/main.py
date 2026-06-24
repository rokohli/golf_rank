from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from sqlalchemy import StaticPool, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Course, OnboardingPreference, Profile, User
from .schemas import CourseOut, OnboardingPreferencesIn, ProfileOut
from .seed import seed_courses


def create_app() -> FastAPI:
    app = FastAPI(title="GolfRank API")
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as session:
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

    def subject(request: Request) -> str:
        value = request.headers.get("X-Development-Subject")
        if not value or not value.startswith("dev:"):
            raise HTTPException(401, "Valid development identity required")
        return value

    @app.put("/api/v1/me/onboarding-preferences", response_model=ProfileOut)
    def save_preferences(payload: OnboardingPreferencesIn, request: Request) -> ProfileOut:
        with sessions() as session:
            user = session.scalar(select(User).where(User.provider_subject == subject(request)))
            if user is None:
                user = User(provider_subject=subject(request)); session.add(user); session.flush()
            profile = session.get(Profile, user.id) or Profile(user_id=user.id, home_region=payload.home_region)
            preferences = session.get(OnboardingPreference, user.id) or OnboardingPreference(user_id=user.id, max_green_fee=payload.max_green_fee, difficulty=payload.difficulty, access=payload.access)
            profile.home_region = payload.home_region
            preferences.max_green_fee = payload.max_green_fee
            preferences.difficulty = payload.difficulty
            preferences.access = payload.access
            session.add_all([profile, preferences]); session.commit()
            return ProfileOut(**payload.model_dump())

    @app.get("/api/v1/me/profile", response_model=ProfileOut)
    def profile(request: Request) -> ProfileOut:
        with sessions() as session:
            user = session.scalar(select(User).where(User.provider_subject == subject(request)))
            if user is None or (stored_profile := session.get(Profile, user.id)) is None or (preferences := session.get(OnboardingPreference, user.id)) is None:
                raise HTTPException(404, "Profile not found")
            return ProfileOut(home_region=stored_profile.home_region, max_green_fee=preferences.max_green_fee, difficulty=preferences.difficulty, access=preferences.access)

    @app.get("/api/v1/courses", response_model=list[CourseOut])
    def courses(q: str | None = None, region: str | None = None, max_green_fee: int | None = None, access: str = "any") -> list[Course]:
        with sessions() as session:
            statement = select(Course)
            if q: statement = statement.where(Course.name.ilike(f"%{q}%"))
            if region: statement = statement.where(Course.region == region)
            if max_green_fee is not None: statement = statement.where(Course.green_fee <= max_green_fee)
            if access != "any": statement = statement.where(Course.is_public == (access == "public"))
            return list(session.scalars(statement.order_by(Course.name)).all())

    return app


app = create_app()
