"""Sourcing real course photos: Wikimedia Commons first, Google Places Photos as fallback."""

import html
import re
import time
from dataclasses import dataclass

import httpx

MAX_TRANSIENT_RETRIES = 3
RETRY_BACKOFF_SECONDS = 3.0


def _request_with_retries(client: httpx.Client, method: str, url: str, **kwargs) -> httpx.Response:
    """A long batch run hits occasional transient network blips (dropped
    connections, brief 429s) from Commons and Places -- retry those instead
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
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
PLACES_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"
PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")

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
    width: int | None = None
    height: int | None = None


@dataclass(frozen=True)
class PlacesPhotoCandidate:
    """Metadata for one Places photo, before it's downloaded."""

    name: str
    width: int
    height: int
    source_name: str
    source_url: str | None
    is_official: bool = False


def _is_official_source(source_name: str, course_name: str) -> bool:
    """True if a Places photo's attribution looks like the course's own
    Business Profile rather than a random visitor -- i.e. most of the
    course's distinctive name words appear in who it's credited to."""
    course_words = _significant_words(course_name)
    if not course_words:
        return False
    source_words = _significant_words(source_name)
    overlap = len(course_words & source_words)
    return overlap >= max(1, len(course_words) - 1)


@dataclass(frozen=True)
class DownloadedPhoto:
    """Raw bytes for one Places photo. Attribution lives on the
    PlacesPhotoCandidate it was downloaded from, not here."""

    data: bytes
    content_type: str


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
        photos.append(ExternalPhoto(
            url=info["url"], source_name=artist, source_url=info["descriptionurl"], width=width, height=height,
        ))
        if len(photos) >= limit:
            break
    return photos


def _strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def resolve_google_place_id(
    client: httpx.Client, *, api_key: str, course_name: str, latitude: float, longitude: float
) -> str | None:
    """Look up a course's Places ID by name, biased toward its known coordinates."""
    response = _request_with_retries(
        client, "POST", PLACES_TEXT_SEARCH_URL,
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "places.id",
            "Content-Type": "application/json",
        },
        json={
            "textQuery": f"{course_name} golf course",
            "locationBias": {
                "circle": {"center": {"latitude": latitude, "longitude": longitude}, "radius": 5000.0},
            },
        },
    )
    response.raise_for_status()
    places = response.json().get("places") or []
    return places[0]["id"] if places else None


def find_google_places_photo_candidates(
    client: httpx.Client, *, api_key: str, google_place_id: str, course_name: str, limit: int = 5
) -> list[PlacesPhotoCandidate]:
    """List a course's Places photos (with dimensions) without downloading them.

    Places returns dimensions inline, so landscape filtering can happen here
    for free, before spending a billed media call on any candidate. Photos
    whose attribution looks like the course's own Business Profile (an
    owner-uploaded, genuinely official photo) are preferred over ones from
    random visitors.
    """
    details = _request_with_retries(
        client, "GET", PLACES_DETAILS_URL.format(place_id=google_place_id),
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "photos.name,photos.authorAttributions,photos.widthPx,photos.heightPx",
        },
    )
    details.raise_for_status()
    photos = details.json().get("photos") or []

    candidates = []
    for photo in photos:
        width, height = photo.get("widthPx"), photo.get("heightPx")
        if not is_landscape(width, height):
            continue
        author_attributions = photo.get("authorAttributions") or []
        if author_attributions:
            source_name = author_attributions[0].get("displayName", "Google")
            source_url = author_attributions[0].get("uri")
        else:
            source_name, source_url = "Google", None
        candidates.append(PlacesPhotoCandidate(
            name=photo["name"], width=width, height=height, source_name=source_name, source_url=source_url,
            is_official=_is_official_source(source_name, course_name),
        ))

    candidates.sort(key=lambda candidate: not candidate.is_official)
    return candidates[:limit]


def download_google_place_photo(
    client: httpx.Client, *, api_key: str, photo_name: str, max_width_px: int = 1200
) -> DownloadedPhoto:
    """Download one Places photo already identified via find_google_places_photo_candidates."""
    media = _request_with_retries(
        client, "GET", PLACES_MEDIA_URL.format(photo_name=photo_name),
        params={"maxWidthPx": max_width_px, "key": api_key, "skipHttpRedirect": "false"},
        follow_redirects=True,
    )
    media.raise_for_status()
    content_type = media.headers.get("content-type", "image/jpeg")
    return DownloadedPhoto(data=media.content, content_type=content_type)
