import httpx
import pytest

from app.course_photos import _request_with_retries, find_wikimedia_photos, is_landscape


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_is_landscape() -> None:
    assert is_landscape(1600, 900) is True
    assert is_landscape(900, 1600) is False
    assert is_landscape(1000, 1000) is False
    assert is_landscape(None, 900) is False
    assert is_landscape(1600, None) is False


def test_find_wikimedia_photos_returns_sized_licensed_landscape_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if params.get("list") == "geosearch":
            return httpx.Response(200, json={
                "query": {"geosearch": [
                    {"title": "File:A mushroom growing nearby.jpg"},
                    {"title": "File:Pebble Beach 7th hole.jpg"},
                    {"title": "File:Pebble Beach clubhouse portrait.jpg"},
                ]},
            })
        assert params["prop"] == "imageinfo"
        assert params["iiurlwidth"] == "1200"
        return httpx.Response(200, json={
            "query": {"pages": {
                "1": {"title": "File:A mushroom growing nearby.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/original-mushroom.jpg",
                    "thumburl": "https://upload.wikimedia.org/thumb/mushroom-1200px.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:A_mushroom.jpg",
                    "extmetadata": {}, "width": 1600, "height": 900,
                }]},
                "2": {"title": "File:Pebble Beach 7th hole.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/original-pebble-beach.jpg",
                    "thumburl": "https://upload.wikimedia.org/thumb/pebble-beach-1200px.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Pebble_Beach_7th_hole.jpg",
                    "extmetadata": {
                        "Artist": {"value": '<a href="https://example.com">Jane Doe</a>'},
                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0/"},
                    },
                    "width": 1600, "height": 900,
                }]},
                "3": {"title": "File:Pebble Beach clubhouse portrait.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/original-portrait.jpg",
                    "thumburl": "https://upload.wikimedia.org/thumb/portrait-1200px.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Pebble_Beach_clubhouse_portrait.jpg",
                    "extmetadata": {}, "width": 900, "height": 1600,
                }]},
            }},
        })

    photos = find_wikimedia_photos(
        _client(handler), course_name="Pebble Beach Golf Links", latitude=36.5, longitude=-121.9
    )

    assert len(photos) == 1
    assert photos[0].url == "https://upload.wikimedia.org/thumb/pebble-beach-1200px.jpg"
    assert photos[0].source_name == "Jane Doe"
    assert photos[0].license_name == "CC BY-SA 4.0"
    assert photos[0].license_url == "https://creativecommons.org/licenses/by-sa/4.0/"
    assert photos[0].width == 1600 and photos[0].height == 900


def test_find_wikimedia_photos_rejects_matches_with_no_golf_context() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if params.get("list") == "geosearch":
            return httpx.Response(200, json={
                "query": {"geosearch": [{"title": "File:1957 Aston Martin DBR2-2 Pebble Beach 2007.jpg"}]},
            })
        return httpx.Response(200, json={"query": {"pages": {"1": {
            "title": "File:1957 Aston Martin DBR2-2 Pebble Beach 2007.jpg",
            "imageinfo": [{
                "thumburl": "https://upload.wikimedia.org/thumb/aston-martin.jpg",
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:Aston_Martin.jpg",
                "extmetadata": {}, "width": 1600, "height": 900,
            }],
        }}}})

    photos = find_wikimedia_photos(
        _client(handler), course_name="Pebble Beach Golf Links", latitude=36.5, longitude=-121.9
    )
    assert photos == []


def test_find_wikimedia_photos_requires_a_resized_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if dict(request.url.params).get("list") == "geosearch":
            return httpx.Response(200, json={
                "query": {"geosearch": [{"title": "File:Pebble Beach golf hole.jpg"}]},
            })
        return httpx.Response(200, json={"query": {"pages": {"1": {
            "title": "File:Pebble Beach golf hole.jpg",
            "imageinfo": [{
                "url": "https://upload.wikimedia.org/original.jpg",
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:Pebble_Beach_golf_hole.jpg",
                "extmetadata": {}, "width": 4000, "height": 2500,
            }],
        }}}})

    assert find_wikimedia_photos(
        _client(handler), course_name="Pebble Beach Golf Links", latitude=36.5, longitude=-121.9
    ) == []


def test_find_wikimedia_photos_returns_empty_when_no_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"query": {"geosearch": []}})

    assert find_wikimedia_photos(
        _client(handler), course_name="Some Golf Club", latitude=0.0, longitude=0.0
    ) == []


def test_max_retries_zero_does_not_retry_a_429_and_raises_immediately() -> None:
    """A synchronous per-request caller (the live course-image resolver)
    passes max_retries=0 so a rate limit doesn't block the request behind
    growing backoff -- see WikimediaImageProvider.lookup."""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(429)

    with pytest.raises(httpx.HTTPStatusError):
        response = _request_with_retries(_client(handler), "GET", "https://commons.wikimedia.org/w/api.php", max_retries=0)
        response.raise_for_status()
    assert attempts == 1
