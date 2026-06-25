from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, current_user, get_settings
from app.core.config import Settings


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
    )

    with patch("app.core.auth.verify_clerk_token", return_value="user_123"):
        response = TestClient(make_test_app(settings)).get(
            "/whoami",
            headers={"Authorization": "Bearer test.jwt"},
        )

    assert response.status_code == 200
    assert response.json() == {"provider_subject": "clerk:user_123"}
