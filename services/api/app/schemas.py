from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class OnboardingData(BaseModel):
    """The richer onboarding answers used to personalize the product.

    Course references are client-stable identifiers for now. Keeping them in the
    onboarding snapshot lets the course catalog evolve without making account
    creation depend on every course already existing in our seed database.
    """

    first_name: str = Field(min_length=2, max_length=80)
    last_name: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=2, max_length=64)
    profile_photo_added: bool = False
    home_course_id: str | None = Field(default=None, max_length=120)
    home_course_search: str = Field(min_length=2, max_length=255)
    played_course_ids: list[str] = Field(default_factory=list, max_length=250)
    favorite_wins: list[str] = Field(default_factory=list, max_length=250)
    dream_course_ids: list[str] = Field(default_factory=list, max_length=250)
    friend_search: str = Field(default="", max_length=120)
    preferences: list[str] = Field(default_factory=list, max_length=50)
    group_size: Literal["Solo", "Twosome", "Foursome"] | None = None
    budget: Literal["$", "$$", "$$$", "$$$$"] | None = None
    travel_distance: str = Field(max_length=120)
    preferred_tee_time: str = Field(max_length=120)
    transportation: Literal["Walking", "Cart", "Either"] | None = None
    notifications: bool | None = None


class OnboardingPreferencesIn(BaseModel):
    home_region: str = Field(min_length=2, max_length=120)
    max_green_fee: int = Field(ge=0, le=2000)
    difficulty: str = Field(pattern="^(beginner|intermediate|challenging|any)$")
    access: str = Field(pattern="^(public|private|any)$")
    onboarding_data: OnboardingData | None = None


class ProfileOut(OnboardingPreferencesIn):
    pass


class CourseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    region: str
    green_fee: int
    difficulty: str
    is_public: bool


RankingTier = Literal["green", "fairway", "rough", "bunker"]
PlacementTier = Literal["green", "fairway", "rough", "bunker", "not_sure"]
ComparisonResult = Literal["course_a", "course_b", "too_close", "not_sure"]


class TierPlacementIn(BaseModel):
    course_id: int = Field(gt=0)
    tier: PlacementTier
    position: int | None = Field(default=None, ge=1)


class TierPlacementsIn(BaseModel):
    assignments: list[TierPlacementIn] = Field(min_length=1, max_length=250)


class ComparisonIn(BaseModel):
    course_a_id: int = Field(gt=0)
    course_b_id: int = Field(gt=0)
    result: ComparisonResult


class RankedCourseOut(BaseModel):
    rank: int
    course: CourseOut
    tier: RankingTier
    tier_position: int
    personal_rating: float = Field(ge=1, le=10)
    confidence: float = Field(ge=0, le=1)
    confidence_label: Literal["low", "medium", "high"]


class RankingSnapshotOut(BaseModel):
    version: int
    algorithm_version: str
    overall_confidence: float = Field(ge=0, le=1)
    entries: list[RankedCourseOut]
    unranked_courses: list[CourseOut] = Field(default_factory=list)
    created_at: datetime | None = None
