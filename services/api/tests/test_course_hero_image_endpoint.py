from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import Course, CourseImage, CourseImageModeration, CourseImageSource


# 19 / 20 / 21 / 22 (frontend-adjacent, backend contract): the course-detail
# endpoint always returns a normalized hero_image the frontend can render
# without knowing which provider produced it, and never fails the endpoint
# when no external image is available.
def test_course_detail_includes_hero_image_none_by_default() -> None:
    client = TestClient(create_app())
    pebble_id = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]

    response = client.get(f"/api/v1/courses/{pebble_id}")

    assert response.status_code == 200
    hero = response.json()["hero_image"]
    assert hero["type"] == "NONE"
    assert hero["url"] is None
    assert hero["alt_text"]


def test_course_detail_hero_image_prefers_official_photo() -> None:
    app = create_app(Settings(course_image_base_url="https://cdn.example/assets"))
    with app.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        session.add(CourseImage(
            course_id=pebble.id,
            external_url="https://example.com/official-hero.jpg",
            alt_text="Pebble Beach official hero",
            source_type=CourseImageSource.OFFICIAL,
            moderation_status=CourseImageModeration.APPROVED,
            is_hero=True,
            position=0,
        ))
        session.commit()
        pebble_id = pebble.id

    client = TestClient(app)
    response = client.get(f"/api/v1/courses/{pebble_id}")

    hero = response.json()["hero_image"]
    assert hero["type"] == "OFFICIAL"
    assert hero["url"] == "https://example.com/official-hero.jpg"


def test_course_detail_hero_image_satellite_fallback_with_mapbox_token() -> None:
    app = create_app(Settings(mapbox_access_token="pk.test"))
    client = TestClient(app)
    pebble_id = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]

    response = client.get(f"/api/v1/courses/{pebble_id}")

    hero = response.json()["hero_image"]
    assert hero["type"] == "SATELLITE"
    assert hero["url"].startswith("https://api.mapbox.com/")
    assert hero["attribution"] == "Mapbox"
