from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

TEST_IDENTITY_TOKEN = "test"


PRODUCTION_SETTINGS = Settings(
    app_env="staging",
    allow_development_identity=False,
    clerk_issuer="https://clerk.example",
    clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
    clerk_secret_key=TEST_IDENTITY_TOKEN,
    contact_identifier_hmac_key="test-contact-identifier-hmac-key-0123456789",
    allowed_hosts="testserver",
)


def test_nondevelopment_disables_interactive_api_docs() -> None:
    client = TestClient(create_app(PRODUCTION_SETTINGS))

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_security_headers_and_safe_request_ids_are_applied() -> None:
    client = TestClient(create_app(PRODUCTION_SETTINGS))

    generated = client.get("/health", headers={"X-Request-ID": "<unsafe>"})
    preserved = client.get("/health", headers={"X-Request-ID": "mobile-request_123"})

    assert generated.headers["x-request-id"] != "<unsafe>"
    assert preserved.headers["x-request-id"] == "mobile-request_123"
    assert generated.headers["strict-transport-security"].startswith("max-age=31536000")
    assert generated.headers["x-content-type-options"] == "nosniff"
    assert generated.headers["x-frame-options"] == "DENY"
    assert generated.headers["referrer-policy"] == "no-referrer"
    assert generated.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"


def test_api_responses_disable_cache_and_reject_untrusted_hosts() -> None:
    client = TestClient(create_app(PRODUCTION_SETTINGS))

    response = client.get("/api/v1/courses")
    rejected = client.get("/health", headers={"Host": "attacker.example"})

    assert response.headers["cache-control"] == "no-store"
    assert rejected.status_code == 400


def test_request_body_limit_rejects_oversized_payloads() -> None:
    settings = Settings(max_request_body_bytes=1024)
    client = TestClient(create_app(settings))

    response = client.post(
        "/api/v1/course-candidates",
        headers={"X-Development-Subject": "dev:submitter"},
        content=b"x" * 1025,
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large"}


def test_cors_preflight_and_simple_request_for_allowed_origins() -> None:
    settings = Settings(
        allowed_hosts="testserver",
        cors_origins="https://getfairway.app,http://localhost:3000",
    )
    client = TestClient(create_app(settings))

    preflight = client.options(
        "/api/v1/courses",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert "GET" in preflight.headers["access-control-allow-methods"]

    response = client.get(
        "/api/v1/courses",
        headers={"Origin": "https://getfairway.app"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://getfairway.app"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "x-request-id" in response.headers["access-control-expose-headers"].lower()

    untrusted = client.get(
        "/api/v1/courses",
        headers={"Origin": "https://attacker.example"},
    )
    assert untrusted.status_code == 200
    assert "access-control-allow-origin" not in untrusted.headers


def test_cors_disabled_by_default() -> None:
    settings = Settings(allowed_hosts="testserver", cors_origins="")
    client = TestClient(create_app(settings))

    response = client.get(
        "/api/v1/courses",
        headers={"Origin": "http://localhost:3000"},
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_wildcard_origin_disables_credentials() -> None:
    settings = Settings(allowed_hosts="testserver", cors_origins="*")
    client = TestClient(create_app(settings))

    response = client.get(
        "/api/v1/courses",
        headers={"Origin": "https://any-site.example"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers.get("access-control-allow-credentials") != "true"


def test_cors_headers_are_present_on_unhandled_500_errors() -> None:
    settings = Settings(
        allowed_hosts="testserver",
        cors_origins="https://getfairway.app,http://localhost:3000",
    )
    app = create_app(settings)

    @app.get("/simulate-unhandled-500")
    def trigger_error():
        raise RuntimeError("Simulated unhandled exception")

    client = TestClient(app, raise_server_exceptions=False)

    # Allowed origin receives CORS header even on 500
    response = client.get(
        "/simulate-unhandled-500",
        headers={"Origin": "https://getfairway.app"},
    )
    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "https://getfairway.app"

    # Untrusted origin does not receive CORS header on 500
    untrusted = client.get(
        "/simulate-unhandled-500",
        headers={"Origin": "https://attacker.example"},
    )
    assert untrusted.status_code == 500
    assert "access-control-allow-origin" not in untrusted.headers


