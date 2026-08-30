import httpx

from app.course_photos import (
    download_google_place_photo,
    find_google_places_photo_candidates,
    find_wikimedia_photos,
    is_landscape,
    resolve_google_place_id,
)


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_is_landscape() -> None:
    assert is_landscape(1600, 900) is True
    assert is_landscape(900, 1600) is False
    assert is_landscape(1000, 1000) is False
    assert is_landscape(None, 900) is False
    assert is_landscape(1600, None) is False


def test_find_wikimedia_photos_returns_relevant_landscape_results() -> None:
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
        return httpx.Response(200, json={
            "query": {"pages": {
                "1": {"title": "File:A mushroom growing nearby.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/mushroom.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:A_mushroom.jpg",
                    "extmetadata": {},
                    "width": 1600, "height": 900,
                }]},
                "2": {"title": "File:Pebble Beach 7th hole.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/pebble-beach.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Pebble_Beach_7th_hole.jpg",
                    "extmetadata": {"Artist": {"value": '<a href="https://example.com">Jane Doe</a>'}},
                    "width": 1600, "height": 900,
                }]},
                "3": {"title": "File:Pebble Beach clubhouse portrait.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/pebble-beach-portrait.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Pebble_Beach_clubhouse_portrait.jpg",
                    "extmetadata": {},
                    "width": 900, "height": 1600,
                }]},
            }},
        })

    photos = find_wikimedia_photos(
        _client(handler), course_name="Pebble Beach Golf Links", latitude=36.5, longitude=-121.9
    )

    assert len(photos) == 1
    assert photos[0].url == "https://upload.wikimedia.org/pebble-beach.jpg"
    assert photos[0].source_name == "Jane Doe"
    assert photos[0].width == 1600 and photos[0].height == 900


def test_find_wikimedia_photos_rejects_matches_with_no_golf_context() -> None:
    # A classic car photographed at the Pebble Beach Concours d'Elegance
    # shares "pebble"/"beach" with the course name and has no denylist word,
    # but it isn't a photo of the golf course.
    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if params.get("list") == "geosearch":
            return httpx.Response(200, json={
                "query": {"geosearch": [{"title": "File:1957 Aston Martin DBR2-2 Pebble Beach 2007.jpg"}]},
            })
        return httpx.Response(200, json={
            "query": {"pages": {"1": {
                "title": "File:1957 Aston Martin DBR2-2 Pebble Beach 2007.jpg",
                "imageinfo": [{
                    "url": "https://upload.wikimedia.org/aston-martin.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Aston_Martin.jpg",
                    "extmetadata": {},
                    "width": 1600, "height": 900,
                }],
            }}},
        })

    photos = find_wikimedia_photos(
        _client(handler), course_name="Pebble Beach Golf Links", latitude=36.5, longitude=-121.9
    )

    assert photos == []


def test_find_wikimedia_photos_returns_empty_when_no_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"query": {"geosearch": []}})

    assert find_wikimedia_photos(_client(handler), course_name="Some Golf Club", latitude=0.0, longitude=0.0) == []


def test_resolve_google_place_id_returns_first_match() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        body = request.content
        assert b"Pebble Beach Golf Links" in body
        return httpx.Response(200, json={"places": [{"id": "abc123"}]})

    place_id = resolve_google_place_id(
        _client(handler), api_key="test-key", course_name="Pebble Beach Golf Links", latitude=36.5, longitude=-121.9
    )

    assert place_id == "abc123"


def test_resolve_google_place_id_returns_none_when_no_match() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"places": []})

    place_id = resolve_google_place_id(
        _client(handler), api_key="test-key", course_name="Nowhere Golf Club", latitude=0.0, longitude=0.0
    )

    assert place_id is None


def test_find_google_places_photo_candidates_filters_to_landscape() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        return httpx.Response(200, json={
            "photos": [
                {
                    "name": "places/abc123/photos/portrait",
                    "widthPx": 900, "heightPx": 1600,
                    "authorAttributions": [{"displayName": "Portrait Photographer"}],
                },
                {
                    "name": "places/abc123/photos/wide",
                    "widthPx": 1600, "heightPx": 900,
                    "authorAttributions": [{"displayName": "A. Golfer", "uri": "https://maps.google.com/contrib/1"}],
                },
            ],
        })

    candidates = find_google_places_photo_candidates(
        _client(handler), api_key="test-key", google_place_id="abc123", course_name="Some Golf Club"
    )

    assert len(candidates) == 1
    assert candidates[0].name == "places/abc123/photos/wide"
    assert candidates[0].source_name == "A. Golfer"
    assert candidates[0].source_url == "https://maps.google.com/contrib/1"


def test_find_google_places_photo_candidates_prefers_official_attribution() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "photos": [
                {
                    "name": "places/abc123/photos/visitor",
                    "widthPx": 1600, "heightPx": 900,
                    "authorAttributions": [{"displayName": "Random Visitor"}],
                },
                {
                    "name": "places/abc123/photos/owner",
                    "widthPx": 1600, "heightPx": 900,
                    "authorAttributions": [{"displayName": "Pasatiempo Golf Club"}],
                },
            ],
        })

    candidates = find_google_places_photo_candidates(
        _client(handler), api_key="test-key", google_place_id="abc123", course_name="Pasatiempo Golf Club", limit=2,
    )

    assert [c.name for c in candidates] == ["places/abc123/photos/owner", "places/abc123/photos/visitor"]
    assert candidates[0].is_official is True
    assert candidates[1].is_official is False


def test_find_google_places_photo_candidates_returns_empty_when_no_photos() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"photos": []})

    candidates = find_google_places_photo_candidates(
        _client(handler), api_key="test-key", google_place_id="abc123", course_name="Some Golf Club"
    )

    assert candidates == []


def test_download_google_place_photo() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/media")
        assert dict(request.url.params)["key"] == "test-key"
        return httpx.Response(200, content=b"binary-jpeg-data", headers={"content-type": "image/jpeg"})

    photo = download_google_place_photo(_client(handler), api_key="test-key", photo_name="places/abc123/photos/wide")

    assert photo.data == b"binary-jpeg-data"
    assert photo.content_type == "image/jpeg"
