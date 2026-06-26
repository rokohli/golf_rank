import pytest

from app.core.config import Settings


def test_production_rejects_development_identity() -> None:
    with pytest.raises(ValueError, match="development-only"):
        Settings(app_env="production", allow_development_identity=True).validate_security()


def test_production_requires_clerk_issuer_when_dev_identity_disabled() -> None:
    with pytest.raises(ValueError, match="CLERK_ISSUER"):
        Settings(
            app_env="production",
            allow_development_identity=False,
            clerk_issuer=None,
            clerk_jwks_url=None,
        ).validate_security()


def test_development_can_run_with_local_identity_without_clerk() -> None:
    Settings(
        app_env="development",
        allow_development_identity=True,
        clerk_issuer=None,
        clerk_jwks_url=None,
    ).validate_security()
