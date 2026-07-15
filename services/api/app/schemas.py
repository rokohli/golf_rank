from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    community_rating: float | None = None
    rating_count: int = 0


RankingTier = Literal["green", "fairway", "rough", "bunker"]
PlacementTier = Literal["green", "fairway", "rough", "bunker", "not_sure"]
ComparisonResult = Literal["course_a", "course_b", "too_close", "not_sure"]


class CourseRatingIn(BaseModel):
    tier: RankingTier
    played_on: date
    score: int | None = Field(default=None, ge=40, le=250)
    comparison_course_id: int | None = Field(default=None, gt=0)
    comparison_result: ComparisonResult | None = None

    @field_validator("played_on")
    @classmethod
    def played_round_cannot_be_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("played_on cannot be in the future")
        return value

    @model_validator(mode="after")
    def comparison_fields_are_paired(self) -> "CourseRatingIn":
        if (self.comparison_course_id is None) != (self.comparison_result is None):
            raise ValueError(
                "comparison_course_id and comparison_result must be provided together"
            )
        return self


class RatingDetailsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str | None = Field(default=None, max_length=5000)
    favorite_hole: int | None = Field(default=None, ge=1, le=18)
    friend_user_ids: list[int] = Field(default_factory=list, max_length=40)
    guest_names: list[str] = Field(default_factory=list, max_length=20)
    visibility: Literal["private", "friends"] = "private"

    @field_validator("guest_names")
    @classmethod
    def validate_guest_names(cls, values: list[str]) -> list[str]:
        for value in values:
            if not value.strip():
                raise ValueError("guest names cannot be blank")
            if len(value.strip()) > 120:
                raise ValueError("guest names cannot exceed 120 characters")
        return values


class RatingRoundOut(BaseModel):
    id: int
    played_on: date
    score: int | None
    note: str | None
    favorite_hole: int | None
    visibility: Literal["private", "friends"]


class RatingCompanionOut(BaseModel):
    friend_user_id: int | None = None
    guest_name: str | None = None


class CourseRatingStateOut(BaseModel):
    course: CourseOut
    personal_rating: float | None = None
    tier: RankingTier | None = None
    confidence: float | None = None
    community_rating: float | None = None
    rating_count: int = 0
    round: RatingRoundOut | None = None
    companions: list[RatingCompanionOut] = Field(default_factory=list)


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
