import httpx
import pytest

from app.course_images.providers.openverse_auth import OpenverseTokenManager

TOKEN_URL = "https://api.openverse.org/v1/auth_tokens/token/"


def make_manager(handler, **overrides) -> OpenverseTokenManager:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    defaults = dict(
        client=client, token_url=TOKEN_URL, client_id="cid", client_secret="csecret", timeout_seconds=5.0,
    )
    defaults.update(overrides)
    return OpenverseTokenManager(**defaults)


def test_get_token_fetches_and_caches():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"access_token": "tok-1", "expires_in": 3600})

    manager = make_manager(handler)
    assert manager.get_token() == "tok-1"
    assert manager.get_token() == "tok-1"
    assert len(calls) == 1  # second call served from cache, no refetch


def test_get_token_refreshes_near_expiry():
    tokens = iter(["tok-1", "tok-2"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"access_token": next(tokens), "expires_in": 1})

    manager = make_manager(handler)
    assert manager.get_token() == "tok-1"
    # expires_in=1 is well inside the refresh margin, so the very next call
    # should trigger a refresh rather than serving the stale cached token.
    assert manager.get_token() == "tok-2"


def test_force_refresh_discards_cache():
    tokens = iter(["tok-1", "tok-2"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"access_token": next(tokens), "expires_in": 3600})

    manager = make_manager(handler)
    assert manager.get_token() == "tok-1"
    assert manager.force_refresh() == "tok-2"
    assert manager.get_token() == "tok-2"


def test_refresh_failure_raises_and_never_logs_secret(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_client"})

    manager = make_manager(handler, client_secret="super-secret-value")
    with caplog.at_level("WARNING"):
        with pytest.raises(httpx.HTTPStatusError):
            manager.get_token()

    for record in caplog.records:
        assert "super-secret-value" not in record.getMessage()
        if record.exc_text:
            assert "super-secret-value" not in record.exc_text
