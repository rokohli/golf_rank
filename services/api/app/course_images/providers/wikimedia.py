"""Wikimedia Commons provider -- the third priority tier, behind OFFICIAL/USER.

Wraps the existing geosearch + relevance filtering in app/course_photos.py
(unchanged, still used by the offline backfill/refresh/score scripts) and adds
a confidence score on top, since "passed the relevance filters" and "we're
confident enough to show this to every visitor" aren't quite the same bar.
"""

from dataclasses import dataclass
from typing import Protocol

import httpx

from ...course_photos import ExternalPhoto, find_wikimedia_photos
from ..types import CourseImageResult


class HasCoursePlace(Protocol):
    name: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class WikimediaLookup:
    result: CourseImageResult | None
    confidence: float
    photo: ExternalPhoto | None


def _confidence(photo: ExternalPhoto) -> float:
    """Every candidate here already passed find_wikimedia_photos' hard filters
    (title overlap with the course name, golf-context words present, no
    negative signals, landscape orientation) -- that's a real floor, not a
    guess. This adds independent positive signals on top so a sparse, barely-
    licensed match still scores lower than a well-attributed, high-res one.
    """
    score = 0.65
    if photo.license_name:
        score += 0.15
    if photo.width and photo.width >= 1600:
        score += 0.1
    if photo.source_name and photo.source_name != "Wikimedia Commons":
        score += 0.1
    return min(score, 1.0)


class WikimediaImageProvider:
    def __init__(self, *, timeout_seconds: float, confidence_threshold: float):
        self._timeout_seconds = timeout_seconds
        self._confidence_threshold = confidence_threshold

    def lookup(self, course: HasCoursePlace) -> WikimediaLookup:
        headers = {"User-Agent": "GolfRank-CourseImageResolver/1.0 (https://github.com/golf-rank/golf_rank)"}
        with httpx.Client(timeout=self._timeout_seconds, headers=headers) as client:
            photos = find_wikimedia_photos(
                client, course_name=course.name, latitude=course.latitude, longitude=course.longitude, limit=1,
            )
        if not photos:
            return WikimediaLookup(result=None, confidence=0.0, photo=None)
        photo = photos[0]
        confidence = _confidence(photo)
        if confidence < self._confidence_threshold:
            return WikimediaLookup(result=None, confidence=confidence, photo=photo)
        result = CourseImageResult(
            type="WIKIMEDIA",
            url=photo.url,
            thumbnail_url=photo.url,
            attribution=photo.source_name,
            license=photo.license_name,
            source_url=photo.source_url,
            alt_text=f"{course.name} course photo",
            width=photo.width,
            height=photo.height,
        )
        return WikimediaLookup(result=result, confidence=confidence, photo=photo)
