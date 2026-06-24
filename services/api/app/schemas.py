from pydantic import BaseModel, ConfigDict, Field


class OnboardingPreferencesIn(BaseModel):
    home_region: str = Field(min_length=2, max_length=120)
    max_green_fee: int = Field(ge=0, le=2000)
    difficulty: str = Field(pattern="^(beginner|intermediate|challenging|any)$")
    access: str = Field(pattern="^(public|private|any)$")


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
