"""Central course-image resolver.

Priority order (do not reorder without updating the module docstring in
providers/mapbox.py and the tests in tests/test_course_image_service.py):

    1. Approved OFFICIAL image
    2. Approved USER image
    3. Approved WIKIMEDIA image already on file (this *is* the Wikimedia cache)
    4. Live Wikimedia Commons search
    5. Mapbox Satellite (URL only, no network call)
    6. NONE

This is the only place that encodes that ordering. Controllers/endpoints call
`resolve_hero_image` and render whatever normalized CourseImageResult comes
back -- they never branch on source type themselves.
"""

import logging
import threading
import time
from collections import Counter
from typing import Protocol

from sqlalchemy.orm import Session

from ..core.config import Settings
from ..domain import storage_image_url
from ..models import CourseImage
from .providers.mapbox import MapboxOptions, MapboxSatelliteImageProvider, SatelliteImageProvider
from .providers.wikimedia import WikimediaImageProvider
from .repository import CourseImageRepository
from .types import CourseImageResult, no_image_result

logger = logging.getLogger("golfrank.course_images")

WIKIMEDIA_PROVIDER_NAME = "wikimedia"


class HasCourse(Protocol):
    id: int
    name: str
    latitude: float | None
    longitude: float | None


class CourseImageMetrics:
    """In-process counters for the resolution-mix / provider-health observability
    the spec asks for (section 23). No external metrics backend is wired up in
    this codebase yet (see final report) -- this gives `/api/v1/ops/...`-style
    introspection or a log-scrape a place to read from, and is cheap to swap for
    statsd/Prometheus later without touching the resolver.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.resolutions_by_type: Counter[str] = Counter()
        self.wikimedia_lookups = 0
        self.wikimedia_successes = 0
        self.wikimedia_low_confidence_rejections = 0
        self.wikimedia_failures = 0
        self.satellite_requests = 0
        self.satellite_skipped_invalid_coordinates = 0

    def record_resolution(self, image_type: str, latency_seconds: float) -> None:
        with self._lock:
            self.resolutions_by_type[image_type] += 1
        logger.info("course_image_resolved type=%s latency_ms=%.1f", image_type, latency_seconds * 1000)

    def snapshot(self) -> dict:
        with self._lock:
            total = sum(self.resolutions_by_type.values()) or 1
            return {
                "resolutions_by_type": dict(self.resolutions_by_type),
                "resolutions_by_type_pct": {
                    key: round(100 * value / total, 1) for key, value in self.resolutions_by_type.items()
                },
                "wikimedia_lookups": self.wikimedia_lookups,
                "wikimedia_successes": self.wikimedia_successes,
                "wikimedia_low_confidence_rejections": self.wikimedia_low_confidence_rejections,
                "wikimedia_failures": self.wikimedia_failures,
                "satellite_requests": self.satellite_requests,
                "satellite_skipped_invalid_coordinates": self.satellite_skipped_invalid_coordinates,
            }


def _course_image_url(settings: Settings, image: CourseImage) -> str | None:
    return image.external_url or storage_image_url(settings.course_image_base_url, image.storage_key)


def _to_result(settings: Settings, image: CourseImage, image_type: str, course_name: str) -> CourseImageResult:
    return CourseImageResult(
        type=image_type,
        url=_course_image_url(settings, image),
        thumbnail_url=image.thumbnail_url or _course_image_url(settings, image),
        attribution=image.source_name,
        license=image.license_name,
        source_url=image.source_url,
        alt_text=image.alt_text or f"{course_name} course photo",
        width=image.width,
        height=image.height,
    )


class CourseImageService:
    def __init__(
        self,
        *,
        settings: Settings,
        repository: CourseImageRepository | None = None,
        wikimedia_provider: WikimediaImageProvider | None = None,
        satellite_provider: SatelliteImageProvider | None = None,
        metrics: CourseImageMetrics | None = None,
    ):
        self._settings = settings
        self._repository = repository or CourseImageRepository()
        self._wikimedia_provider = wikimedia_provider or WikimediaImageProvider(
            timeout_seconds=settings.wikimedia_lookup_timeout_seconds,
            confidence_threshold=settings.wikimedia_confidence_threshold,
        )
        self._satellite_provider = satellite_provider or MapboxSatelliteImageProvider(
            access_token=settings.mapbox_access_token,
        )
        self.metrics = metrics or CourseImageMetrics()
        # Per-process request coalescing: many concurrent viewers of a course
        # that has never been looked up before shouldn't each fire an
        # independent Wikimedia search. A distributed lock (e.g. via Redis,
        # already used elsewhere for rate limiting) would coalesce across
        # worker processes too -- flagged as a follow-up in the final report.
        self._wikimedia_locks_guard = threading.Lock()
        self._wikimedia_locks: dict[int, threading.Lock] = {}

    def _wikimedia_lock(self, course_id: int) -> threading.Lock:
        with self._wikimedia_locks_guard:
            lock = self._wikimedia_locks.get(course_id)
            if lock is None:
                lock = threading.Lock()
                self._wikimedia_locks[course_id] = lock
            return lock

    def resolve_hero_image(self, session: Session, course: HasCourse) -> CourseImageResult:
        started = time.monotonic()
        result = self._resolve(session, course)
        self.metrics.record_resolution(result.type, time.monotonic() - started)
        return result

    def _resolve(self, session: Session, course: HasCourse) -> CourseImageResult:
        official = self._repository.best_official_image(session, course.id)
        if official is not None:
            return _to_result(self._settings, official, "OFFICIAL", course.name)

        user = self._repository.best_user_image(session, course.id)
        if user is not None:
            return _to_result(self._settings, user, "USER", course.name)

        wikimedia_result = self._resolve_wikimedia(session, course)
        if wikimedia_result is not None:
            return wikimedia_result

        satellite = self._resolve_satellite(course)
        if satellite is not None:
            return satellite

        return no_image_result(course.name)

    def _resolve_wikimedia(self, session: Session, course: HasCourse) -> CourseImageResult | None:
        cached = self._repository.best_wikimedia_image(session, course.id)
        if cached is not None:
            return _to_result(self._settings, cached, "WIKIMEDIA", course.name)

        if not self._settings.wikimedia_live_lookup_enabled:
            return None

        negative = self._repository.get_negative_cache(session, course.id, WIKIMEDIA_PROVIDER_NAME)
        if negative is not None:
            return None

        if course.latitude is None or course.longitude is None:
            return None

        with self._wikimedia_lock(course.id):
            # Re-check after acquiring the lock: another thread may have just
            # resolved (and committed) this course while we were waiting.
            cached = self._repository.best_wikimedia_image(session, course.id)
            if cached is not None:
                return _to_result(self._settings, cached, "WIKIMEDIA", course.name)
            negative = self._repository.get_negative_cache(session, course.id, WIKIMEDIA_PROVIDER_NAME)
            if negative is not None:
                return None

            self.metrics.wikimedia_lookups += 1
            try:
                lookup = self._wikimedia_provider.lookup(course)
            except Exception:
                # Fail open: a Wikimedia outage must never break the course
                # page, and a transient failure isn't cached (so we retry on
                # the next request rather than sitting behind a negative TTL).
                logger.warning("course_image_wikimedia_lookup_failed course_id=%s", course.id, exc_info=True)
                self.metrics.wikimedia_failures += 1
                return None

            if lookup.result is None:
                if lookup.photo is not None:
                    self.metrics.wikimedia_low_confidence_rejections += 1
                self._repository.set_negative_cache(
                    session, course.id, WIKIMEDIA_PROVIDER_NAME,
                    ttl_seconds=self._settings.wikimedia_cache_negative_ttl_seconds,
                )
                return None

            self.metrics.wikimedia_successes += 1
            photo = lookup.photo
            self._repository.add_wikimedia_image(
                session, course.id,
                external_url=photo.url, thumbnail_url=photo.url,
                alt_text=f"{course.name} course photo",
                source_name=photo.source_name, source_url=photo.source_url,
                license_name=photo.license_name, license_url=photo.license_url,
                width=photo.width, height=photo.height,
            )
            return lookup.result

    def _resolve_satellite(self, course: HasCourse) -> CourseImageResult | None:
        if course.latitude is None or course.longitude is None:
            self.metrics.satellite_skipped_invalid_coordinates += 1
            return None
        self.metrics.satellite_requests += 1
        options = MapboxOptions(
            width=self._settings.mapbox_static_image_width,
            height=self._settings.mapbox_static_image_height,
            zoom=self._settings.mapbox_static_image_zoom,
            pixel_ratio=self._settings.mapbox_static_image_pixel_ratio,
        )
        try:
            return self._satellite_provider.get_course_image(course, options)
        except Exception:
            logger.warning("course_image_satellite_failed course_id=%s", course.id, exc_info=True)
            return None
