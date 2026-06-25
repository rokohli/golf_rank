from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Course


COURSES = [
    {"name": "Pebble Beach Golf Links", "region": "Monterey, CA", "latitude": 36.568, "longitude": -121.949, "is_public": True, "difficulty": "challenging", "green_fee": 675},
    {"name": "Spyglass Hill Golf Course", "region": "Monterey, CA", "latitude": 36.585, "longitude": -121.942, "is_public": True, "difficulty": "challenging", "green_fee": 495},
    {"name": "Pasatiempo Golf Club", "region": "Santa Cruz, CA", "latitude": 37.004, "longitude": -121.998, "is_public": True, "difficulty": "challenging", "green_fee": 410},
]


def seed_courses(session: Session) -> None:
    for values in COURSES:
        if session.scalar(select(Course).where(Course.name == values["name"])) is None:
            session.add(Course(**values))
    session.commit()
