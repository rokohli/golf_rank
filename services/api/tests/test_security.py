from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


PRODUCTION_SETTINGS = Settings(
    app_env="staging",
    allow_development_identity=False,
    clerk_issuer="https://clerk.example",
    clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
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
