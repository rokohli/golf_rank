from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    allow_development_identity: bool = True
    database_url: str = "sqlite+pysqlite://"
    database_pool_size: int = 5
    database_max_overflow: int = 10
    clerk_issuer: str | None = None
    clerk_jwks_url: str | None = None
    clerk_audience: str | None = None
    course_image_base_url: str | None = None
    redis_url: str | None = None
    rate_limit_enabled: bool = False
    rate_limit_key_salt: str = "development-rate-limit-key"
    trusted_client_ip_header: str = ""
    allowed_hosts: str = "testserver,localhost,127.0.0.1"
    max_request_body_bytes: int = 1_048_576
    readiness_cache_seconds: float = 5.0
    operations_alert_webhook_url: str | None = None
    operations_alert_webhook_timeout_seconds: float = 2.0
    rate_limit_alert_window_seconds: int = 300
    rate_limit_backend_failure_alert_threshold: int = 3
    rate_limit_denial_alert_threshold: int = 50
    rate_limit_identity_alert_threshold: int = 10
    rate_limit_alert_cooldown_seconds: int = 900
    rate_limit_alert_max_tracked_keys: int = 10_000

    public_rate_limit_capacity: int = 60
    public_rate_limit_refill_per_second: float = 1.0
    authenticated_read_capacity: int = 120
    authenticated_read_refill_per_second: float = 2.0
    authenticated_write_capacity: int = 20
    authenticated_write_refill_per_second: float = 1 / 3
    candidate_rate_limit_capacity: int = 2
    candidate_rate_limit_refill_per_second: float = 1 / 3600
    candidate_daily_quota: int = 5
    readiness_rate_limit_capacity: int = 10
    readiness_rate_limit_refill_per_second: float = 0.1

    def validate_security(self) -> None:
        if self.app_env != "development" and self.allow_development_identity:
            raise ValueError("ALLOW_DEVELOPMENT_IDENTITY is development-only")
        if self.app_env != "development" and not self.clerk_issuer:
            raise ValueError("CLERK_ISSUER is required outside development")
        if self.app_env != "development" and not self.clerk_jwks_url:
            raise ValueError("CLERK_JWKS_URL is required outside development")
        if self.rate_limit_enabled and not self.redis_url:
            raise ValueError("REDIS_URL is required when rate limiting is enabled")
        if self.app_env != "development" and self.rate_limit_enabled and len(self.rate_limit_key_salt) < 32:
            raise ValueError("RATE_LIMIT_KEY_SALT must contain at least 32 characters")
        if self.max_request_body_bytes < 1024:
            raise ValueError("MAX_REQUEST_BODY_BYTES must be at least 1024")
        if self.trusted_client_ip_header not in {"", "cf-connecting-ip"}:
            raise ValueError(
                "TRUSTED_CLIENT_IP_HEADER must be empty or cf-connecting-ip"
            )
        positive_alert_settings = {
            "OPERATIONS_ALERT_WEBHOOK_TIMEOUT_SECONDS": (
                self.operations_alert_webhook_timeout_seconds
            ),
            "RATE_LIMIT_ALERT_WINDOW_SECONDS": self.rate_limit_alert_window_seconds,
            "RATE_LIMIT_BACKEND_FAILURE_ALERT_THRESHOLD": (
                self.rate_limit_backend_failure_alert_threshold
            ),
            "RATE_LIMIT_DENIAL_ALERT_THRESHOLD": self.rate_limit_denial_alert_threshold,
            "RATE_LIMIT_IDENTITY_ALERT_THRESHOLD": self.rate_limit_identity_alert_threshold,
            "RATE_LIMIT_ALERT_COOLDOWN_SECONDS": self.rate_limit_alert_cooldown_seconds,
            "RATE_LIMIT_ALERT_MAX_TRACKED_KEYS": self.rate_limit_alert_max_tracked_keys,
        }
        for name, value in positive_alert_settings.items():
            if value <= 0:
                raise ValueError(f"{name} must be greater than zero")
        if self.operations_alert_webhook_url:
            alert_url = urlsplit(self.operations_alert_webhook_url)
            if not alert_url.scheme or not alert_url.netloc:
                raise ValueError("OPERATIONS_ALERT_WEBHOOK_URL must be an absolute URL")
            if self.app_env != "development" and alert_url.scheme != "https":
                raise ValueError(
                    "OPERATIONS_ALERT_WEBHOOK_URL must use HTTPS outside development"
                )

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]
