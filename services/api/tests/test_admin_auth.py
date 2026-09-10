import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.admin import is_admin, require_admin
from app.core.auth import CurrentUser
from app.core.config import Settings
from app.main import create_app

ADMIN = {"X-Development-Subject": "dev:admin"}
REGULAR = {"X-Development-Subject": "dev:regular"}

PRODUCTION_IDENTITY = {
    "app_env": "production",
    "allow_development_identity": False,
    "clerk_issuer": "https://clerk.example",
    "clerk_jwks_url": "https://clerk.example/.well-known/jwks.json",
    "clerk_secret_key": "test",
    "contact_identifier_hmac_key": "x" * 32,
}


def _client(*, admin_clerk_subjects: str = "dev:admin") -> TestClient:
    return TestClient(create_app(Settings(
        wikimedia_live_lookup_enabled=False,
        admin_clerk_subjects=admin_clerk_subjects,
    )))


def _settings(admin_clerk_subjects: str) -> Settings:
    return Settings(
        wikimedia_live_lookup_enabled=False,
        admin_clerk_subjects=admin_clerk_subjects,
    )


# --- the allowlist itself -------------------------------------------------


def test_admin_subject_set_parses_and_trims_entries() -> None:
    settings = _settings(" dev:admin , clerk:user_2abc ,, ")

    assert settings.admin_subject_set == {"dev:admin", "clerk:user_2abc"}


def test_admin_subject_set_is_empty_by_default() -> None:
    assert Settings(wikimedia_live_lookup_enabled=False).admin_subject_set == set()


def test_unprefixed_subject_is_rejected() -> None:
    # A bare Clerk user id matches no provider_subject, so it would silently
    # grant nobody access -- that must fail loudly, not look like a deploy.
    with pytest.raises(ValueError, match="prefixed with clerk: or dev:"):
        _settings("user_2abc").validate_security()


def test_dev_subject_is_rejected_outside_development() -> None:
    with pytest.raises(ValueError, match="dev: subjects in development"):
        Settings(**PRODUCTION_IDENTITY, admin_clerk_subjects="dev:admin").validate_security()


def test_clerk_subject_is_accepted_outside_development() -> None:
    Settings(**PRODUCTION_IDENTITY, admin_clerk_subjects="clerk:user_2abc").validate_security()


# --- require_admin --------------------------------------------------------


def test_require_admin_allows_a_listed_subject() -> None:
    settings = _settings("dev:admin")
    current = CurrentUser(provider_subject="dev:admin")

    assert require_admin(settings, current) is current


def test_require_admin_404s_an_unlisted_subject() -> None:
    settings = _settings("dev:admin")

    with pytest.raises(HTTPException) as error:
        require_admin(settings, CurrentUser(provider_subject="dev:regular"))

    # 404 rather than 403 so the admin surface isn't enumerable.
    assert error.value.status_code == 404


def test_require_admin_fails_closed_on_an_empty_allowlist() -> None:
    settings = _settings("")

    with pytest.raises(HTTPException) as error:
        require_admin(settings, CurrentUser(provider_subject="dev:admin"))

    assert error.value.status_code == 404


def test_require_admin_matches_the_full_prefixed_subject() -> None:
    settings = _settings("clerk:user_2abc")

    assert is_admin(settings, CurrentUser(provider_subject="clerk:user_2abc"))
    # The bare id must not match the prefixed allowlist entry, or vice versa.
    assert not is_admin(settings, CurrentUser(provider_subject="user_2abc"))
    assert not is_admin(settings, CurrentUser(provider_subject="dev:user_2abc"))


# --- GET /api/v1/me/admin -------------------------------------------------


def test_admin_probe_reports_true_for_an_admin() -> None:
    response = _client().get("/api/v1/me/admin", headers=ADMIN)

    assert response.status_code == 200
    assert response.json() == {"is_admin": True}


def test_admin_probe_reports_false_for_a_regular_user() -> None:
    # Deliberately 200-with-false, not 404: the client needs this answer to
    # decide whether to render a moderation entry point at all.
    response = _client().get("/api/v1/me/admin", headers=REGULAR)

    assert response.status_code == 200
    assert response.json() == {"is_admin": False}


def test_admin_probe_reports_false_when_no_admins_are_configured() -> None:
    response = _client(admin_clerk_subjects="").get("/api/v1/me/admin", headers=ADMIN)

    assert response.status_code == 200
    assert response.json() == {"is_admin": False}


def test_admin_probe_requires_authentication() -> None:
    response = _client().get("/api/v1/me/admin")

    assert response.status_code == 401
