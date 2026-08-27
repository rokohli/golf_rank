from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, _verified_identifiers, current_user, get_settings, verified_identifiers
from app.core.config import Settings


CLERK_ISSUER = "https://example.clerk.accounts.dev"
CLERK_JWKS_URL = f"{CLERK_ISSUER}/.well-known/jwks.json"
CLERK_AUDIENCE = "fairway-api-staging"
CONTACT_HMAC_KEY = "test-contact-identifier-hmac-key-0123456789"
TEST_IDENTITY_TOKEN = "test"


@pytest.fixture(scope="module")
def clerk_signing_keys():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def make_clerk_token(private_key, *, audience=CLERK_AUDIENCE) -> str:
    payload = {"iss": CLERK_ISSUER, "sub": "user_123"}
    if audience is not None:
        payload["aud"] = audience
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": "test-key"})


def audience_settings() -> Settings:
    return Settings(
        app_env="production",
        allow_development_identity=False,
        clerk_issuer=CLERK_ISSUER,
        clerk_jwks_url=CLERK_JWKS_URL,
        clerk_audience=CLERK_AUDIENCE,
        clerk_secret_key=TEST_IDENTITY_TOKEN,
        contact_identifier_hmac_key=CONTACT_HMAC_KEY,
    )


def make_test_app(settings: Settings) -> FastAPI:
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user: CurrentUser = Depends(current_user)) -> dict[str, str]:
        return {"provider_subject": user.provider_subject}

    app.dependency_overrides[get_settings] = lambda: settings
    return app


def test_development_header_bypass_still_works() -> None:
    response = TestClient(make_test_app(Settings(app_env="development", allow_development_identity=True))).get(
        "/whoami",
        headers={"X-Development-Subject": "dev:local-user"},
    )

    assert response.status_code == 200
    assert response.json() == {"provider_subject": "dev:local-user"}


def test_production_rejects_missing_bearer_token() -> None:
    response = TestClient(
        make_test_app(
            Settings(
                app_env="production",
                allow_development_identity=False,
                clerk_issuer="https://example.clerk.accounts.dev",
                clerk_jwks_url="https://example.clerk.accounts.dev/.well-known/jwks.json",
                contact_identifier_hmac_key=CONTACT_HMAC_KEY,
                clerk_secret_key=TEST_IDENTITY_TOKEN,
            )
        )
    ).get("/whoami")

    assert response.status_code == 401


def test_clerk_bearer_token_resolves_current_user() -> None:
    settings = Settings(
        app_env="production",
        allow_development_identity=False,
        clerk_issuer="https://example.clerk.accounts.dev",
        clerk_jwks_url="https://example.clerk.accounts.dev/.well-known/jwks.json",
        contact_identifier_hmac_key=CONTACT_HMAC_KEY,
        clerk_secret_key=TEST_IDENTITY_TOKEN,
    )

    with patch("app.core.auth.verify_clerk_token", return_value="user_123"):
        response = TestClient(make_test_app(settings)).get(
            "/whoami",
            headers={"Authorization": "Bearer test.jwt"},
        )

    assert response.status_code == 200
    assert response.json() == {"provider_subject": "clerk:user_123"}


def test_only_verified_clerk_contact_identifiers_are_extracted_from_backend_user() -> None:
    assert _verified_identifiers({
        "email_addresses": [{"email_address": "golfer@example.com", "verification": {"status": "verified"}}],
        "phone_numbers": [{"phone_number": "+14155551212", "verification": {"status": "verified"}}],
    }) == ("golfer@example.com", "+14155551212")
    assert _verified_identifiers({"email_addresses": [{"email_address": "unverified@example.com", "verification": {"status": "unverified"}}]}) == ()
    assert _verified_identifiers({"email_addresses": [{"email_address": "pending@example.com", "verification": None}]}) == ()
    assert _verified_identifiers({"phone_numbers": [{"phone_number": "+14155550000", "verification": None}]}) == ()


def test_verified_identifiers_load_from_clerk_backend_api() -> None:
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {"email_addresses": [{"email_address": "golfer@example.com", "verification": {"status": "verified"}}]},
    )
    with patch("app.core.auth.httpx.get", return_value=response) as get:
        assert verified_identifiers(CurrentUser("clerk:user_123"), audience_settings()) == ("golfer@example.com",)
    get.assert_called_once_with(
        "https://api.clerk.com/v1/users/user_123",
        headers={"Authorization": f"Bearer {TEST_IDENTITY_TOKEN}"},
        timeout=5.0,
    )


def test_configured_clerk_audience_accepts_expected_value(clerk_signing_keys) -> None:
    private_key, public_key = clerk_signing_keys
    token = make_clerk_token(private_key)

    with patch(
        "app.core.auth.jwks_client",
        return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(key=public_key)
        ),
    ):
        response = TestClient(make_test_app(audience_settings())).get(
            "/whoami",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    assert response.json() == {"provider_subject": "clerk:user_123"}


@pytest.mark.parametrize(
    "audience",
    [
        pytest.param(None, id="missing"),
        pytest.param(123, id="malformed"),
        pytest.param("another-service", id="different"),
    ],
)
def test_configured_clerk_audience_rejects_invalid_values_with_generic_401(
    clerk_signing_keys,
    audience,
) -> None:
    private_key, public_key = clerk_signing_keys
    token = make_clerk_token(private_key, audience=audience)

    with patch(
        "app.core.auth.jwks_client",
        return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(key=public_key)
        ),
    ):
        response = TestClient(make_test_app(audience_settings())).get(
            "/whoami",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid authentication token"}
