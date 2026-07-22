from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Course


TEST_COURSES = [
    {"name": "Pebble Beach Golf Links", "region": "Monterey, CA", "latitude": 36.568, "longitude": -121.949, "is_public": True, "difficulty": "challenging", "green_fee": 675, "source": "seed", "source_course_id": "pebble", "country_code": "US", "admin1_code": "CA", "admin1_name": "California", "city": "Monterey", "course_name": "Pebble Beach Golf Links", "hole_count": 18, "par": 72, "slope_rating": 145, "tee_time_url": "https://www.pebblebeach.com/plan-my-trip/preview-availability/", "access": "public"},
    {"name": "Spyglass Hill Golf Course", "region": "Monterey, CA", "latitude": 36.585, "longitude": -121.942, "is_public": True, "difficulty": "challenging", "green_fee": 495, "source": "seed", "source_course_id": "spyglass", "country_code": "US", "admin1_code": "CA", "admin1_name": "California", "city": "Monterey", "course_name": "Spyglass Hill Golf Course", "hole_count": 18, "par": 72, "slope_rating": 145, "tee_time_url": "https://www.pebblebeach.com/plan-my-trip/preview-availability/", "access": "public"},
    {"name": "Pasatiempo Golf Club", "region": "Santa Cruz, CA", "latitude": 37.004, "longitude": -121.998, "is_public": True, "difficulty": "challenging", "green_fee": 410, "source": "seed", "source_course_id": "pasatiempo", "country_code": "US", "admin1_code": "CA", "admin1_name": "California", "city": "Santa Cruz", "course_name": "Pasatiempo Golf Club", "hole_count": 18, "par": 70, "slope_rating": 141, "tee_time_url": "https://www.pasatiempo.com/golf/rates", "access": "public"},
]


def seed_test_courses(session: Session) -> None:
    """Install deterministic SQLite fixtures; never use these as a deployed catalog."""

    for values in TEST_COURSES:
        existing = session.scalar(select(Course).where(Course.name == values["name"]))
        if existing is None:
            session.add(Course(**values))
        elif existing.source == "seed":
            for key in ("hole_count", "par", "slope_rating", "tee_time_url"):
                setattr(existing, key, values[key])
    session.commit()
