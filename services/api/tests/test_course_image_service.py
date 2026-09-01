from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.course_images.providers.mapbox import MapboxOptions
from app.course_images.providers.wikimedia import WikimediaLookup
from app.course_images.repository import CourseImageRepository
from app.course_images.service import CourseImageService
from app.course_images.types import CourseImageResult
from app.core.config import Settings
from app.course_photos import ExternalPhoto
from app.db import make_engine, make_session_factory
from app.models import Base, Course, CourseImage, CourseImageModeration, CourseImageSource


@pytest.fixture()
def session() -> Session:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine)
    with factory() as db_session:
        yield db_session


def make_course(session: Session, **overrides) -> Course:
    defaults = dict(name="Pebble Beach Golf Links", region="Pebble Beach, CA", latitude=36.5681, longitude=-121.9491)
    defaults.update(overrides)
    course = Course(**defaults)
    session.add(course)
    session.commit()
    return course


def add_image(session: Session, course: Course, **overrides) -> CourseImage:
    defaults = dict(
        course_id=course.id,
        external_url="https://example.com/photo.jpg",
        source_type=CourseImageSource.USER,
        moderation_status=CourseImageModeration.APPROVED,
        is_hero=False,
        position=session.query(CourseImage).filter_by(course_id=course.id).count(),
    )
    defaults.update(overrides)
    image = CourseImage(**defaults)
    session.add(image)
    session.commit()
    return image


class FakeWikimediaProvider:
    def __init__(self, lookup: WikimediaLookup | None = None, error: Exception | None = None):
        self._lookup = lookup
        self._error = error
        self.calls = 0

    def lookup(self, course):
        self.calls += 1
        if self._error:
            raise self._error
        return self._lookup


class FakeSatelliteProvider:
    def __init__(self, result: CourseImageResult | None = None, error: Exception | None = None):
        self._result = result
        self._error = error
        self.calls: list = []

    def get_course_image(self, course, options: MapboxOptions):
        self.calls.append((course, options))
        if self._error:
            raise self._error
        return self._result


def make_service(session: Session, *, wikimedia=None, satellite=None, positive_ttl_seconds=None) -> CourseImageService:
    return CourseImageService(
        settings=Settings(
            mapbox_access_token="pk.test", wikimedia_live_lookup_enabled=True,
            **({"wikimedia_cache_positive_ttl_seconds": positive_ttl_seconds} if positive_ttl_seconds is not None else {}),
        ),
        repository=CourseImageRepository(),
        wikimedia_provider=wikimedia or FakeWikimediaProvider(lookup=WikimediaLookup(None, 0.0, None)),
        satellite_provider=satellite or FakeSatelliteProvider(),
    )


def satellite_result(course_name: str) -> CourseImageResult:
    return CourseImageResult(
        type="SATELLITE", url="https://api.mapbox.com/x.png", thumbnail_url=None, attribution="Mapbox",
        license=None, source_url=None, alt_text=f"Aerial view of {course_name}", width=1280, height=640,
    )


def wikimedia_lookup(course_name: str, *, confidence: float = 0.9) -> WikimediaLookup:
    photo = ExternalPhoto(
        url="https://upload.wikimedia.org/photo.jpg", source_name="Jane Doe",
        source_url="https://commons.wikimedia.org/wiki/File:X.jpg",
        license_name="CC BY-SA 4.0", license_url="https://creativecommons.org/licenses/by-sa/4.0/",
        width=1920, height=1080,
    )
    result = CourseImageResult(
        type="WIKIMEDIA", url=photo.url, thumbnail_url=photo.url, attribution=photo.source_name,
        license=photo.license_name, source_url=photo.source_url, alt_text=f"{course_name} course photo",
        width=photo.width, height=photo.height,
    )
    return WikimediaLookup(result=result, confidence=confidence, photo=photo)


# 1. approved official photo overrides all other sources
def test_official_overrides_everything(session):
    course = make_course(session)
    add_image(session, course, source_type=CourseImageSource.USER, is_hero=True)
    add_image(session, course, source_type=CourseImageSource.OFFICIAL, external_url="https://example.com/official.jpg")
    satellite = FakeSatelliteProvider(satellite_result(course.name))
    service = make_service(session, satellite=satellite)

    result = service.resolve_hero_image(session, course)

    assert result.type == "OFFICIAL"
    assert result.url == "https://example.com/official.jpg"
    assert satellite.calls == []  # 10. Mapbox is NOT called if a higher-priority image exists


# 2. approved user photo is used when there is no official image
def test_user_used_when_no_official(session):
    course = make_course(session)
    add_image(session, course, source_type=CourseImageSource.USER, external_url="https://example.com/user.jpg")

    result = make_service(session).resolve_hero_image(session, course)

    assert result.type == "USER"
    assert result.url == "https://example.com/user.jpg"


# 3. rejected user image is ignored
def test_rejected_user_image_ignored(session):
    course = make_course(session)
    add_image(session, course, source_type=CourseImageSource.USER, moderation_status=CourseImageModeration.REJECTED)

    result = make_service(session).resolve_hero_image(session, course)

    assert result.type == "NONE"


# 4. pending user image is ignored
def test_pending_user_image_ignored(session):
    course = make_course(session)
    add_image(session, course, source_type=CourseImageSource.USER, moderation_status=CourseImageModeration.PENDING)

    result = make_service(session).resolve_hero_image(session, course)

    assert result.type == "NONE"


# 5. featured user image wins over non-featured images
def test_featured_user_image_wins(session):
    course = make_course(session)
    add_image(session, course, external_url="https://example.com/plain.jpg", quality_score=9.0)
    featured = add_image(session, course, external_url="https://example.com/featured.jpg", is_hero=True, quality_score=1.0)

    result = make_service(session).resolve_hero_image(session, course)

    assert result.url == featured.external_url


# 6. Wikimedia is used when no owned image exists
def test_wikimedia_used_when_no_owned_image(session):
    course = make_course(session)
    wikimedia = FakeWikimediaProvider(lookup=wikimedia_lookup(course.name))

    result = make_service(session, wikimedia=wikimedia).resolve_hero_image(session, course)

    assert result.type == "WIKIMEDIA"
    assert wikimedia.calls == 1


# 7. cached Wikimedia result avoids a new external request
def test_cached_wikimedia_avoids_new_request(session):
    course = make_course(session)
    add_image(session, course, source_type=CourseImageSource.WIKIMEDIA, external_url="https://example.com/cached.jpg")
    wikimedia = FakeWikimediaProvider(lookup=wikimedia_lookup(course.name))

    result = make_service(session, wikimedia=wikimedia).resolve_hero_image(session, course)

    assert result.url == "https://example.com/cached.jpg"
    assert wikimedia.calls == 0


# 8. low-confidence Wikimedia result is rejected
def test_low_confidence_wikimedia_rejected_falls_to_satellite(session):
    course = make_course(session)
    photo = ExternalPhoto(url="x", source_name="?", source_url="y", width=400, height=300)
    wikimedia = FakeWikimediaProvider(lookup=WikimediaLookup(result=None, confidence=0.2, photo=photo))
    satellite = FakeSatelliteProvider(satellite_result(course.name))

    result = make_service(session, wikimedia=wikimedia, satellite=satellite).resolve_hero_image(session, course)

    assert result.type == "SATELLITE"


# 9. Mapbox is used when Wikimedia returns no trustworthy result
def test_mapbox_used_when_wikimedia_has_nothing(session):
    course = make_course(session)
    satellite = FakeSatelliteProvider(satellite_result(course.name))

    result = make_service(session, satellite=satellite).resolve_hero_image(session, course)

    assert result.type == "SATELLITE"
    assert len(satellite.calls) == 1


# 11. Mapbox is not called for invalid coordinates -- the real provider (not
# a fake that would blindly accept anything) refuses out-of-range coordinates
# and the resolver falls through to NONE rather than rendering a bogus image.
def test_mapbox_declines_invalid_coordinates_and_resolver_falls_to_none(session):
    from app.course_images.providers.mapbox import MapboxSatelliteImageProvider

    course = make_course(session, latitude=200.0, longitude=-121.9491)
    wikimedia = FakeWikimediaProvider(lookup=WikimediaLookup(None, 0.0, None))
    satellite = MapboxSatelliteImageProvider(access_token="pk.test")

    result = make_service(session, wikimedia=wikimedia, satellite=satellite).resolve_hero_image(session, course)

    assert result.type == "NONE"


# 12. NONE is returned when Mapbox fails / 13. Mapbox failure does not break resolution
def test_none_returned_when_mapbox_fails(session):
    satellite = FakeSatelliteProvider(error=RuntimeError("mapbox down"))
    course = make_course(session)

    result = make_service(session, satellite=satellite).resolve_hero_image(session, course)

    assert result.type == "NONE"


# 14. Wikimedia failure falls through to Mapbox
def test_wikimedia_failure_falls_through_to_mapbox(session):
    course = make_course(session)
    wikimedia = FakeWikimediaProvider(error=RuntimeError("commons unavailable"))
    satellite = FakeSatelliteProvider(satellite_result(course.name))

    result = make_service(session, wikimedia=wikimedia, satellite=satellite).resolve_hero_image(session, course)

    assert result.type == "SATELLITE"


# transient Wikimedia failures must not be cached (so the next request retries)
def test_wikimedia_failure_is_not_cached(session):
    course = make_course(session)
    wikimedia = FakeWikimediaProvider(error=RuntimeError("commons unavailable"))
    service = make_service(session, wikimedia=wikimedia)

    service.resolve_hero_image(session, course)
    assert service._repository.get_negative_cache(session, course.id, "wikimedia") is None


# 15. correct attribution/license metadata is returned
def test_attribution_and_license_metadata(session):
    course = make_course(session)
    wikimedia = FakeWikimediaProvider(lookup=wikimedia_lookup(course.name))

    result = make_service(session, wikimedia=wikimedia).resolve_hero_image(session, course)

    assert result.attribution == "Jane Doe"
    assert result.license == "CC BY-SA 4.0"
    assert result.source_url == "https://commons.wikimedia.org/wiki/File:X.jpg"


# 16 / 17 / 18. no separate hero cache to go stale -- official/user reads are
# always live, so promoting/demoting a source is reflected on the very next call
def test_newly_approved_user_image_replaces_satellite_fallback(session):
    course = make_course(session)
    satellite = FakeSatelliteProvider(satellite_result(course.name))
    service = make_service(session, satellite=satellite)
    assert service.resolve_hero_image(session, course).type == "SATELLITE"

    add_image(session, course, source_type=CourseImageSource.USER, external_url="https://example.com/new-user.jpg")

    assert service.resolve_hero_image(session, course).type == "USER"


def test_newly_approved_official_image_replaces_user(session):
    course = make_course(session)
    add_image(session, course, source_type=CourseImageSource.USER)
    service = make_service(session)
    assert service.resolve_hero_image(session, course).type == "USER"

    add_image(session, course, source_type=CourseImageSource.OFFICIAL, external_url="https://example.com/official.jpg")

    assert service.resolve_hero_image(session, course).type == "OFFICIAL"


def test_negative_cache_expires(session):
    course = make_course(session)
    repo = CourseImageRepository()
    repo.set_negative_cache(session, course.id, "wikimedia", ttl_seconds=-1)

    assert repo.get_negative_cache(session, course.id, "wikimedia") is None


# a positive Wikimedia cache entry past its TTL is refreshed via a live lookup
# rather than served forever
def test_stale_wikimedia_cache_triggers_refresh(session):
    course = make_course(session)
    add_image(
        session, course, source_type=CourseImageSource.WIKIMEDIA,
        external_url="https://example.com/stale.jpg",
    )
    wikimedia = FakeWikimediaProvider(lookup=wikimedia_lookup(course.name))
    service = make_service(session, wikimedia=wikimedia, positive_ttl_seconds=-1)

    result = service.resolve_hero_image(session, course)

    assert wikimedia.calls == 1
    assert result.type == "WIKIMEDIA"
    assert result.url != "https://example.com/stale.jpg"
    # the refresh replaced the stale row rather than accumulating alongside it
    remaining = session.query(CourseImage).filter_by(
        course_id=course.id, source_type=CourseImageSource.WIKIMEDIA,
    ).all()
    assert len(remaining) == 1


# a stale cache entry is still served (rather than nothing) when the refresh
# attempt itself fails -- fail open, same as any other Wikimedia error
def test_stale_wikimedia_cache_served_when_refresh_fails(session):
    course = make_course(session)
    add_image(
        session, course, source_type=CourseImageSource.WIKIMEDIA,
        external_url="https://example.com/stale.jpg",
    )
    wikimedia = FakeWikimediaProvider(error=RuntimeError("commons unavailable"))
    service = make_service(session, wikimedia=wikimedia, positive_ttl_seconds=-1)

    result = service.resolve_hero_image(session, course)

    assert result.type == "WIKIMEDIA"
    assert result.url == "https://example.com/stale.jpg"


def test_coordinate_change_invalidates_negative_cache(session):
    course = make_course(session)
    repo = CourseImageRepository()
    repo.set_negative_cache(session, course.id, "wikimedia", ttl_seconds=3600)
    assert repo.get_negative_cache(session, course.id, "wikimedia") is not None

    repo.invalidate_negative_cache(session, course.id)

    assert repo.get_negative_cache(session, course.id, "wikimedia") is None
