from math import asin, cos, radians, sin, sqrt

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import require_user
from .models import Course, CourseCandidate


router = APIRouter(tags=["course-catalog"])


class CourseRegionOut(BaseModel):
    country_code: str
    admin1_code: str | None
    admin1_name: str | None
    city: str | None
    course_count: int


class CourseRegionsOut(BaseModel):
    regions: list[CourseRegionOut]


class CourseCandidateIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    admin1_code: str | None = Field(default=None, max_length=12)
    notes: str | None = Field(default=None, max_length=1000)


class CourseCandidateOut(BaseModel):
    id: int
    name: str
    city: str | None
    admin1_code: str | None
    status: str


@router.get("/api/v1/course-regions", response_model=CourseRegionsOut)
def course_regions(session: Session = Depends(get_session)) -> CourseRegionsOut:
    rows = session.execute(
        select(
            Course.country_code,
            Course.admin1_code,
            Course.admin1_name,
            Course.city,
            func.count(Course.id),
        )
        .where(Course.status == "active")
        .group_by(Course.country_code, Course.admin1_code, Course.admin1_name, Course.city)
        .order_by(Course.country_code, Course.admin1_code, Course.city)
    ).all()
    return CourseRegionsOut(regions=[
        CourseRegionOut(
            country_code=country,
            admin1_code=admin1,
            admin1_name=admin1_name,
            city=city,
            course_count=count,
        )
        for country, admin1, admin1_name, city, count in rows
    ])


@router.post("/api/v1/course-candidates", response_model=CourseCandidateOut, status_code=201)
def submit_course_candidate(
    payload: CourseCandidateIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> CourseCandidateOut:
    user = require_user(session, current)
    candidate = CourseCandidate(
        submitted_by_user_id=user.id,
        name=payload.name.strip(),
        city=payload.city.strip() if payload.city else None,
        admin1_code=payload.admin1_code.strip().upper() if payload.admin1_code else None,
        notes=payload.notes.strip() if payload.notes else None,
    )
    session.add(candidate)
    session.commit()
    return CourseCandidateOut(
        id=candidate.id,
        name=candidate.name,
        city=candidate.city,
        admin1_code=candidate.admin1_code,
        status=candidate.status,
    )


def miles_between(latitude: float, longitude: float, course: Course) -> float:
    earth_radius_miles = 3958.8
    lat1, lon1, lat2, lon2 = map(radians, (latitude, longitude, course.latitude, course.longitude))
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = sin(delta_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
    return 2 * earth_radius_miles * asin(sqrt(value))
