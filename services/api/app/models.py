from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_subject: Mapped[str] = mapped_column(String(255), unique=True, index=True)


class Profile(Base):
    __tablename__ = "profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    home_region: Mapped[str] = mapped_column(String(120))


class OnboardingPreference(Base):
    __tablename__ = "onboarding_preferences"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    max_green_fee: Mapped[int] = mapped_column(Integer)
    difficulty: Mapped[str] = mapped_column(String(20))
    access: Mapped[str] = mapped_column(String(20))


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    region: Mapped[str] = mapped_column(String(120), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    is_public: Mapped[bool] = mapped_column(Boolean, index=True)
    difficulty: Mapped[str] = mapped_column(String(20), index=True)
    green_fee: Mapped[int] = mapped_column(Integer, index=True)
