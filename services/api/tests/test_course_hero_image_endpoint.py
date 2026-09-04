from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import Course, CourseImage, CourseImageModeration, CourseImageSource


# 19 / 20 / 21 / 22 (frontend-adjacent, backend contract): the course-detail
# endpoint always returns a normalized hero_image the frontend can render
# without knowing which provider produced it, and never fails the endpoint
# when no external image is available.
def test_course_detail_includes_hero_image_none_by_default() -> None:
    # wikimedia_live_lookup_enabled is True in production; disabled here so
    # this test stays hermetic and doesn't depend on network access.
    client = TestClient(create_app(Settings(wikimedia_live_lookup_enabled=False)))
    pebble_id = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]

    response = client.get(f"/api/v1/courses/{pebble_id}")

    assert response.status_code == 200
    hero = response.json()["hero_image"]
    assert hero["type"] == "NONE"
    assert hero["url"] is None
    assert hero["alt_text"]


def test_course_detail_hero_image_prefers_official_photo() -> None:
    app = create_app(Settings(
        course_image_base_url="https://cdn.example/assets", wikimedia_live_lookup_enabled=False,
    ))
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
    app = create_app(Settings(mapbox_access_token="pk.test", wikimedia_live_lookup_enabled=False))
    client = TestClient(app)
    pebble_id = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]

    response = client.get(f"/api/v1/courses/{pebble_id}")

    hero = response.json()["hero_image"]
    assert hero["type"] == "SATELLITE"
    assert hero["url"].startswith("https://api.mapbox.com/")
    assert hero["attribution"] == "Mapbox"


def test_course_list_card_hero_respects_negative_cache_and_suppresses_gallery_siblings() -> None:
    app = create_app(Settings(wikimedia_live_lookup_enabled=False))
    with app.state.session_factory() as session:
        from app.course_images.repository import CourseImageRepository
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        session.add(CourseImage(
            course_id=pebble.id,
            external_url="https://example.com/wiki-sibling.jpg",
            alt_text="Pebble Beach wiki sibling",
            source_type=CourseImageSource.WIKIMEDIA,
            source_name="Commons User",
            source_url="https://commons.wikimedia.org/wiki/File:Sibling.jpg",
            moderation_status=CourseImageModeration.APPROVED,
            is_hero=False,
            position=1,
        ))
        CourseImageRepository().set_negative_cache(session, pebble.id, "wikimedia", ttl_seconds=3600)
        session.commit()
        pebble_id = pebble.id

    client = TestClient(app)
    response = client.get("/api/v1/courses", params={"q": "Pebble"})
    assert response.status_code == 200
    course = next(c for c in response.json() if c["id"] == pebble_id)
    hero = course["hero_image"]
    assert hero is not None
    assert hero["type"] == "NONE"
    assert hero["url"] is None
    assert any(img["url"] == "https://example.com/wiki-sibling.jpg" for img in course["images"])


def test_course_list_card_hero_prefers_curated_official_despite_negative_cache() -> None:
    app = create_app(Settings(wikimedia_live_lookup_enabled=False))
    with app.state.session_factory() as session:
        from app.course_images.repository import CourseImageRepository
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        session.add(CourseImage(
            course_id=pebble.id,
            external_url="https://example.com/curated-official.jpg",
            alt_text="Pebble Beach official",
            source_type=CourseImageSource.OFFICIAL,
            moderation_status=CourseImageModeration.APPROVED,
            is_hero=True,
            position=0,
        ))
        CourseImageRepository().set_negative_cache(session, pebble.id, "wikimedia", ttl_seconds=3600)
        session.commit()
        pebble_id = pebble.id

    client = TestClient(app)
    response = client.get("/api/v1/courses", params={"q": "Pebble"})
    assert response.status_code == 200
    course = next(c for c in response.json() if c["id"] == pebble_id)
    hero = course["hero_image"]
    assert hero is not None
    assert hero["type"] == "OFFICIAL"
    assert hero["url"] == "https://example.com/curated-official.jpg"


def test_course_list_card_hero_expires_stale_wikimedia_and_falls_through() -> None:
    from datetime import datetime, timedelta, timezone

    # 1. Stale Wikimedia photo (>30 days old) with mapbox token configured -> falls through to SATELLITE
    app = create_app(Settings(
        mapbox_access_token="pk.test",
        wikimedia_live_lookup_enabled=False,
        wikimedia_cache_positive_ttl_seconds=30 * 24 * 3600,
    ))
    with app.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        stale_date = datetime.now(timezone.utc) - timedelta(days=40)
        session.add(CourseImage(
            course_id=pebble.id,
            external_url="https://example.com/stale-wiki.jpg",
            alt_text="Pebble Beach stale photo",
            source_type=CourseImageSource.WIKIMEDIA,
            source_name="Commons User",
            source_url="https://commons.wikimedia.org/wiki/File:Stale.jpg",
            moderation_status=CourseImageModeration.APPROVED,
            is_hero=True,
            position=0,
            created_at=stale_date,
        ))
        session.commit()
        pebble_id = pebble.id

    client = TestClient(app)
    response = client.get("/api/v1/courses", params={"q": "Pebble"})
    assert response.status_code == 200
    course = next(c for c in response.json() if c["id"] == pebble_id)
    hero = course["hero_image"]
    assert hero is not None
    assert hero["type"] == "SATELLITE"
    assert hero["url"].startswith("https://api.mapbox.com/")

    # 2. Fresh Wikimedia photo (<30 days old) -> returns WIKIMEDIA
    app_fresh = create_app(Settings(
        mapbox_access_token="pk.test",
        wikimedia_live_lookup_enabled=False,
        wikimedia_cache_positive_ttl_seconds=30 * 24 * 3600,
    ))
    with app_fresh.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        fresh_date = datetime.now(timezone.utc) - timedelta(days=5)
        session.add(CourseImage(
            course_id=pebble.id,
            external_url="https://example.com/fresh-wiki.jpg",
            alt_text="Pebble Beach fresh photo",
            source_type=CourseImageSource.WIKIMEDIA,
            source_name="Commons User",
            source_url="https://commons.wikimedia.org/wiki/File:Fresh.jpg",
            moderation_status=CourseImageModeration.APPROVED,
            is_hero=True,
            position=0,
            created_at=fresh_date,
        ))
        session.commit()
        fresh_pebble_id = pebble.id

    client_fresh = TestClient(app_fresh)
    response_fresh = client_fresh.get("/api/v1/courses", params={"q": "Pebble"})
    assert response_fresh.status_code == 200
    course_fresh = next(c for c in response_fresh.json() if c["id"] == fresh_pebble_id)
    hero_fresh = course_fresh["hero_image"]
    assert hero_fresh is not None
    assert hero_fresh["type"] == "WIKIMEDIA"
    assert hero_fresh["url"] == "https://example.com/fresh-wiki.jpg"

