"""Mapbox Satellite via the Static Images API -- the aerial fallback tier.

This provider only *builds a URL*; it never fetches the image itself. That
keeps it cheap (no outbound request, no timeout/retry needed on our side) and
sidesteps the question of whether Mapbox's terms allow us to copy their
imagery into our own storage (see Settings.mapbox_access_token docstring and
the final implementation report for the licensing note). The frontend loads
the URL directly, the same way it loads any other photographic hero.
"""

from dataclasses import dataclass
from typing import Protocol

from ..types import CourseImageResult

MAPBOX_STATIC_URL = "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/{lon},{lat},{zoom}/{width}x{height}{density}"


class HasCoursePlace(Protocol):
    name: str
    latitude: float | None
    longitude: float | None


@dataclass(frozen=True)
class MapboxOptions:
    width: int
    height: int
    zoom: float
    pixel_ratio: int = 1


class SatelliteImageProvider(Protocol):
    """The abstraction the rest of the app depends on -- never MapboxSatelliteImageProvider directly."""

    def get_course_image(self, course: HasCoursePlace, options: MapboxOptions) -> CourseImageResult | None: ...


def _valid_coordinate(latitude: float | None, longitude: float | None) -> bool:
    if latitude is None or longitude is None:
        return False
    return -90 <= latitude <= 90 and -180 <= longitude <= 180 and not (latitude == 0 and longitude == 0)


class MapboxSatelliteImageProvider:
    """Initial SatelliteImageProvider implementation. All Mapbox-specific URL
    construction lives exclusively here -- nowhere else in the app should
    build a Mapbox URL or know its shape.

    Course bounding boxes/polygons aren't available yet, so this centers on
    lat/lon with a configurable zoom. If course geometry becomes available
    later, this is the only place that needs to change to fit the property
    into frame instead of using a fixed zoom.
    """

    def __init__(self, *, access_token: str | None):
        self._access_token = access_token

    def get_course_image(self, course: HasCoursePlace, options: MapboxOptions) -> CourseImageResult | None:
        if not self._access_token:
            return None
        if not _valid_coordinate(course.latitude, course.longitude):
            return None
        density = "@2x" if options.pixel_ratio == 2 else ""
        url = MAPBOX_STATIC_URL.format(
            lon=course.longitude,
            lat=course.latitude,
            zoom=options.zoom,
            width=options.width,
            height=options.height,
            density=density,
        ) + f"?access_token={self._access_token}"
        pixel_width = options.width * options.pixel_ratio
        pixel_height = options.height * options.pixel_ratio
        return CourseImageResult(
            type="SATELLITE",
            url=url,
            thumbnail_url=None,
            attribution="Mapbox",
            license=None,
            license_url=None,
            source_url=None,
            alt_text=f"Aerial view of {course.name}",
            width=pixel_width,
            height=pixel_height,
        )
