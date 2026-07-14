from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_provider_subject", "provider_subject"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_subject: Mapped[str] = mapped_column(String(255), unique=True)


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
    onboarding_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)


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


class TierAssignment(Base):
    """Canonical tier and position for one course in a user's personal list."""

    __tablename__ = "tier_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_tier_assignment_user_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    tier: Mapped[str] = mapped_column(String(20), index=True)
    ordinal_position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Comparison(Base):
    """Append-only answer to a pairwise course comparison."""

    __tablename__ = "comparisons"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_a_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    course_b_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    preferred_course_id: Mapped[int | None] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=True
    )
    outcome: Mapped[str] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RankingConfidence(Base):
    """Derived, inspectable confidence for a course's current placement."""

    __tablename__ = "ranking_confidences"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_ranking_confidence_user_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    score: Mapped[float] = mapped_column(Float)
    decisive_comparisons: Mapped[int] = mapped_column(Integer, default=0)
    uncertain_comparisons: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RankingSnapshot(Base):
    """Immutable, versioned rendering of the personal ranking."""

    __tablename__ = "ranking_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", "version", name="uq_ranking_snapshot_user_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    algorithm_version: Mapped[str] = mapped_column(String(40))
    overall_confidence: Mapped[float] = mapped_column(Float)
    ranking_data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Round(Base):
    __tablename__ = "rounds"
    __table_args__ = (
        UniqueConstraint("id", "user_id", "course_id", name="uq_round_id_user_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    played_on: Mapped[date] = mapped_column(Date, index=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    favorite_hole: Mapped[int | None] = mapped_column(Integer, nullable=True)
    visibility: Mapped[str] = mapped_column(String(20), default="friends", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserCourseRating(Base):
    __tablename__ = "user_course_ratings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["round_id", "user_id", "course_id"],
            ["rounds.id", "rounds.user_id", "rounds.course_id"],
            name="fk_user_course_rating_round_owner",
            ondelete="CASCADE",
        ),
        UniqueConstraint("user_id", "course_id", name="uq_user_course_rating_user_course"),
        UniqueConstraint("round_id", name="uq_user_course_rating_round"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    round_id: Mapped[int] = mapped_column(Integer)
    tier: Mapped[str] = mapped_column(String(20), index=True)
    rating: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RoundCompanion(Base):
    __tablename__ = "round_companions"
    __table_args__ = (
        CheckConstraint(
            "(friend_user_id IS NOT NULL AND guest_name IS NULL) OR "
            "(friend_user_id IS NULL AND guest_name IS NOT NULL)",
            name="ck_round_companion_exactly_one_identity",
        ),
        UniqueConstraint("round_id", "friend_user_id", name="uq_round_companion_round_friend"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id", ondelete="CASCADE"), index=True)
    friend_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    guest_name: Mapped[str | None] = mapped_column(String(255), nullable=True)


class RoundNote(Base):
    __tablename__ = "round_notes"

    round_id: Mapped[int] = mapped_column(
        ForeignKey("rounds.id", ondelete="CASCADE"), primary_key=True
    )
    body: Mapped[str] = mapped_column(Text)


class UserCourseState(Base):
    __tablename__ = "user_course_states"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_user_course_state_user_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    has_played: Mapped[bool] = mapped_column(Boolean, default=False)
    round_count: Mapped[int] = mapped_column(Integer, default=0)
    last_played_on: Mapped[date | None] = mapped_column(Date, nullable=True)


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint("follower_id", "followed_id", name="uq_follow_follower_followed"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    followed_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    subject_type: Mapped[str] = mapped_column(String(40))
    subject_id: Mapped[int] = mapped_column(Integer)
    visibility: Mapped[str] = mapped_column(String(20), default="friends", index=True)
    event_data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class SavedList(Base):
    __tablename__ = "saved_lists"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_saved_list_user_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    visibility: Mapped[str] = mapped_column(String(20), default="private")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedCourse(Base):
    __tablename__ = "saved_courses"
    __table_args__ = (
        UniqueConstraint("list_id", "course_id", name="uq_saved_course_list_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("saved_lists.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PlanConstraint(Base):
    __tablename__ = "plan_constraints"

    plan_id: Mapped[int] = mapped_column(
        ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True
    )
    constraint_data: Mapped[dict] = mapped_column(JSON)


class PlanCandidate(Base):
    __tablename__ = "plan_candidates"
    __table_args__ = (
        UniqueConstraint("plan_id", "course_id", name="uq_plan_candidate_plan_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    distance_miles: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasons: Mapped[list] = mapped_column(JSON)
    caveats: Mapped[list] = mapped_column(JSON)
    source_checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ItineraryItem(Base):
    __tablename__ = "itinerary_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )
    item_date: Mapped[date] = mapped_column(Date)
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    start_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    details: Mapped[dict] = mapped_column(JSON)
