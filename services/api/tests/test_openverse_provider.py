import httpx

from app.course_images.providers.openverse import OpenverseImageProvider


class FakeTokenManager:
    def get_token(self) -> str:
        return "tok"

    def force_refresh(self) -> str:
        return "tok"


class FakeCourse:
    def __init__(self, *, name, course_name=None, facility_name=None, city=None, admin1_name=None):
        self.name = name
        self.course_name = course_name
        self.facility_name = facility_name
        self.city = city
        self.admin1_name = admin1_name


def _result(**overrides):
    defaults = dict(
        id="asset-1", title="Pebble Beach Golf Links, 7th hole", description=None,
        url="https://example.com/photo.jpg", thumbnail="https://example.com/thumb.jpg",
        creator="Jane Doe", creator_url="https://example.com/jane",
        license="by", license_url="https://creativecommons.org/licenses/by/4.0/",
        source="flickr", foreign_landing_url="https://flickr.com/x/1",
        width=2000, height=1200, category="photograph", tags=[],
    )
    defaults.update(overrides)
    return defaults


def make_provider(handler, **overrides) -> OpenverseImageProvider:
    provider = OpenverseImageProvider(
        api_base_url="https://api.openverse.org", token_manager=FakeTokenManager(),
        timeout_seconds=5.0, auto_accept_threshold=70, min_width=1200, allowed_licenses={"by", "cc0"},
    )
    provider._client = httpx.Client(transport=httpx.MockTransport(handler))
    return provider


def test_search_auto_accepts_high_confidence_match():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [_result()]})

    provider = make_provider(handler)
    course = FakeCourse(name="Pebble Beach Golf Links", city="Pebble Beach", admin1_name="CA")

    lookup = provider.search(course)

    assert lookup.result is not None
    assert lookup.result.type == "OPENVERSE"
    assert lookup.result.url == "https://example.com/photo.jpg"


def test_search_stops_at_first_productive_query():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        query = request.url.params.get("q")
        calls.append(query)
        if len(calls) == 1:
            return httpx.Response(200, json={"results": []})
        return httpx.Response(200, json={"results": [_result()]})

    provider = make_provider(handler)
    course = FakeCourse(name="Pebble Beach Golf Links", city="Pebble Beach", admin1_name="CA")

    lookup = provider.search(course)

    assert lookup.result is not None
    assert len(calls) == 2  # first query empty, second query productive, third never tried


def test_search_review_band_does_not_auto_accept_but_returns_candidate():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [_result(title="golf course somewhere")]})

    provider = make_provider(handler)
    course = FakeCourse(name="Pebble Beach Golf Links", city="Pebble Beach", admin1_name="CA")

    lookup = provider.search(course)

    assert lookup.result is None
    assert lookup.top_candidate is not None


def test_search_no_results_at_all():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    provider = make_provider(handler)
    course = FakeCourse(name="Pebble Beach Golf Links", city="Pebble Beach", admin1_name="CA")

    lookup = provider.search(course)

    assert lookup.result is None
    assert lookup.top_candidate is None


def test_search_fails_open_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    provider = make_provider(handler)
    course = FakeCourse(name="Pebble Beach Golf Links", city="Pebble Beach", admin1_name="CA")

    lookup = provider.search(course)

    assert lookup.result is None
    assert lookup.top_candidate is None
