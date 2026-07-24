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


def test_production_requires_clerk_jwks_url() -> None:
    with pytest.raises(ValueError, match="CLERK_JWKS_URL"):
        Settings(
            app_env="production",
            allow_development_identity=False,
            clerk_issuer="https://clerk.example",
            clerk_jwks_url=None,
        ).validate_security()


def test_enabled_rate_limiting_requires_redis_and_a_strong_nondevelopment_salt() -> None:
    with pytest.raises(ValueError, match="REDIS_URL"):
        Settings(rate_limit_enabled=True, redis_url=None).validate_security()

    with pytest.raises(ValueError, match="RATE_LIMIT_KEY_SALT"):
        Settings(
            app_env="staging",
            allow_development_identity=False,
            clerk_issuer="https://clerk.example",
            clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
            rate_limit_enabled=True,
            redis_url="redis://redis:6379",
            rate_limit_key_salt="short",
        ).validate_security()


def test_staging_alert_webhook_requires_https_and_positive_thresholds() -> None:
    base = Settings(
        app_env="staging",
        allow_development_identity=False,
        clerk_issuer="https://clerk.example.test",
        clerk_jwks_url="https://clerk.example.test/.well-known/jwks.json",
    )

    with pytest.raises(ValueError, match="OPERATIONS_ALERT_WEBHOOK_URL must use HTTPS"):
        base.model_copy(
            update={"operations_alert_webhook_url": "http://alerts.example.test"}
        ).validate_security()
    with pytest.raises(
        ValueError, match="RATE_LIMIT_DENIAL_ALERT_THRESHOLD must be greater than zero"
    ):
        base.model_copy(update={"rate_limit_denial_alert_threshold": 0}).validate_security()
    with pytest.raises(ValueError, match="must be a valid absolute URL"):
        base.model_copy(
            update={
                "operations_alert_webhook_url": "https://alerts.example.test:abc/hook"
            }
        ).validate_security()


def test_development_can_run_with_local_identity_without_clerk() -> None:
    Settings(
        app_env="development",
        allow_development_identity=True,
        clerk_issuer=None,
        clerk_jwks_url=None,
    ).validate_security()


def test_only_cloudflare_client_ip_header_can_be_trusted() -> None:
    with pytest.raises(ValueError, match="TRUSTED_CLIENT_IP_HEADER"):
        Settings(trusted_client_ip_header="x-forwarded-for").validate_security()


def test_enabled_ai_planner_requires_provider_key_and_positive_cost_controls() -> None:
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        Settings(ai_planner_enabled=True, gemini_api_key=None).validate_security()

    with pytest.raises(ValueError, match="AI_PLANNER_MONTHLY_COST_LIMIT_CENTS"):
        Settings(ai_planner_monthly_cost_limit_cents=0).validate_security()

    with pytest.raises(ValueError, match="RATE_LIMIT_ENABLED"):
        Settings(
            app_env="staging",
            allow_development_identity=False,
            clerk_issuer="https://clerk.example.test",
            clerk_jwks_url="https://clerk.example.test/.well-known/jwks.json",
            ai_planner_enabled=True,
            gemini_api_key="test-key",
            rate_limit_enabled=False,
        ).validate_security()

    with pytest.raises(ValueError, match="AI_PLANNER_ALLOWED_SUBJECTS"):
        Settings(
            ai_planner_enabled=True,
            gemini_api_key="test-key",
            ai_planner_data_tier="unpaid",
        ).validate_security()

    Settings(
        ai_planner_enabled=True,
        gemini_api_key="test-key",
        ai_planner_data_tier="unpaid",
        ai_planner_allowed_subjects="dev:plan-alice",
    ).validate_security()

    with pytest.raises(ValueError, match="AI_PLANNER_DATA_TIER"):
        Settings(ai_planner_data_tier="unknown").validate_security()
