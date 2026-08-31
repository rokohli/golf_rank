"""Source attributable, appropriately sized course photos from Wikimedia Commons."""

import html
import re
import time
from dataclasses import dataclass

import httpx

MAX_TRANSIENT_RETRIES = 3
RETRY_BACKOFF_SECONDS = 3.0


def _request_with_retries(client: httpx.Client, method: str, url: str, **kwargs) -> httpx.Response:
    """A long batch run hits occasional transient network blips (dropped
    connections and brief 429s from Commons -- retry those instead
    of letting one bad request kill an hours-long job."""
    for attempt in range(MAX_TRANSIENT_RETRIES + 1):
        try:
            response = client.request(method, url, **kwargs)
        except httpx.TransportError:
            if attempt == MAX_TRANSIENT_RETRIES:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
            continue
        if response.status_code == 429 and attempt < MAX_TRANSIENT_RETRIES:
            time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
            continue
        return response
    raise AssertionError("unreachable")


COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")
THUMBNAIL_WIDTH_PX = 1200

# A photo narrower than it is tall (a clubhouse facade, a person, a sign) is
# rarely a good "course photo" -- hole/fairway/green shots are almost always
# wide. This is a cheap proxy for "looks like a course photo" that needs no
# actual image understanding.
MIN_LANDSCAPE_RATIO = 1.2

# Generic enough that matching on them alone would accept almost any nearby
# photo (a mushroom, a mansion, a beach) rather than one of this course.
COURSE_NAME_STOPWORDS = {
    "golf", "course", "courses", "club", "links", "the", "at", "of", "and",
    "national", "municipal", "county", "city", "park", "resort",
}

# A title-word overlap with the course name isn't enough on its own -- these
# signal a photo of nearby real estate or hospitality rather than the course
# itself (e.g. "Spanish Bay Residences" for "The Links At Spanish Bay").
NEGATIVE_TITLE_SIGNALS = {
    "residence", "residences", "mansion", "house", "hotel", "inn", "lodge",
    "apartment", "apartments", "condo", "condos", "spa", "restaurant",
    "hospital", "church", "cemetery", "school",
    # Famous course-adjacent events (e.g. the Pebble Beach Concours
    # d'Elegance car show) put unrelated subjects under the course's name.
    "car", "cars", "automobile", "vehicle", "convertible", "roadster",
    "concours", "wedding", "aerial", "map", "logo",
}

# A denylist can't anticipate every off-topic subject (a car's specific
# make/model won't contain the word "car"). Requiring one of these instead
# is a positive check: the title has to actually claim to be about golf.
GOLF_CONTEXT_WORDS = {
    "golf", "hole", "green", "fairway", "tee", "links", "clubhouse",
    "bunker", "putting", "pin", "caddie",
}


def _significant_words(text: str) -> set[str]:
    words = re.findall(r"[a-z]+", text.lower())
    return {word for word in words if word not in COURSE_NAME_STOPWORDS and len(word) > 2}


def _raw_words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def is_landscape(width: int | None, height: int | None) -> bool:
    if not width or not height:
        return False
    return width / height >= MIN_LANDSCAPE_RATIO


@dataclass(frozen=True)
class ExternalPhoto:
    """A photo hosted on Commons that we link to directly (no re-hosting)."""

    url: str
    source_name: str
    source_url: str
    license_name: str | None = None
    license_url: str | None = None
    width: int | None = None
    height: int | None = None


def find_wikimedia_photos(
    client: httpx.Client,
    *,
    course_name: str,
    latitude: float,
    longitude: float,
    radius_meters: int = 1000,
    limit: int = 5,
) -> list[ExternalPhoto]:
    """Find geo-tagged, landscape photos on Wikimedia Commons near a course.

    Commons geosearch returns anything nearby regardless of subject (a
    mushroom, a mansion, a beach), so results are also required to share a
    distinctive word with the course's name -- otherwise we'd mislabel an
    unrelated photo as this course.
    """
    course_words = _significant_words(course_name)
    if not course_words:
        return []

    geosearch = _request_with_retries(
        client, "GET", COMMONS_API_URL,
        params={
            "action": "query",
            "list": "geosearch",
            "gscoord": f"{latitude}|{longitude}",
            "gsradius": radius_meters,
            "gsnamespace": 6,  # File namespace
            "gslimit": 20,
            "format": "json",
        },
    )
    geosearch.raise_for_status()
    results = geosearch.json().get("query", {}).get("geosearch", [])
    titles = [item["title"] for item in results if item["title"].lower().endswith(IMAGE_EXTENSIONS)]
    if not titles:
        return []

    imageinfo = _request_with_retries(
        client, "GET", COMMONS_API_URL,
        params={
            "action": "query",
            "titles": "|".join(titles),
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|size",
            "iiurlwidth": THUMBNAIL_WIDTH_PX,
            "format": "json",
        },
    )
    imageinfo.raise_for_status()
    pages = imageinfo.json().get("query", {}).get("pages", {})

    photos = []
    for page in pages.values():
        info = (page.get("imageinfo") or [None])[0]
        if info is None:
            continue
        raw_title_words = _raw_words(page.get("title", ""))
        title_words = raw_title_words - COURSE_NAME_STOPWORDS
        if not (title_words & course_words):
            continue
        if title_words & NEGATIVE_TITLE_SIGNALS:
            continue
        if not (raw_title_words & GOLF_CONTEXT_WORDS):
            continue
        width, height = info.get("width"), info.get("height")
        if not is_landscape(width, height):
            continue
        extmetadata = info.get("extmetadata", {})
        artist_html = extmetadata.get("Artist", {}).get("value", "")
        artist = _strip_html(artist_html) or "Wikimedia Commons"
        license_name = _metadata_value(extmetadata, "LicenseShortName") or _metadata_value(
            extmetadata, "UsageTerms"
        )
        license_url = _metadata_value(extmetadata, "LicenseUrl")
        thumbnail_url = info.get("thumburl")
        description_url = info.get("descriptionurl")
        if not thumbnail_url or not description_url:
            continue
        photos.append(ExternalPhoto(
            url=thumbnail_url,
            source_name=artist,
            source_url=description_url,
            license_name=license_name,
            license_url=license_url,
            width=width,
            height=height,
        ))
        if len(photos) >= limit:
            break
    return photos


def _strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def _metadata_value(extmetadata: dict, key: str) -> str | None:
    value = extmetadata.get(key, {}).get("value")
    if not isinstance(value, str):
        return None
    normalized = _strip_html(value)
    return normalized or None
