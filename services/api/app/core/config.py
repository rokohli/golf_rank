import httpx
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
    ai_planner_enabled: bool = False
    ai_planner_provider: str = "gemini"
    gemini_api_key: str | None = None
    ai_planner_data_tier: str = "paid"
    ai_planner_allowed_subjects: str = ""
    ai_planner_model: str = "gemini-2.5-flash"
    ai_planner_timeout_seconds: float = 12.0
    ai_planner_max_output_tokens: int = 1200
    ai_planner_rate_limit_capacity: int = 3
    ai_planner_rate_limit_refill_per_second: float = 1 / 120
    ai_planner_daily_quota: int = 25
    ai_planner_monthly_cost_limit_cents: int = 1000
    ai_planner_input_cost_micros_per_million_tokens: int = 540_000
    ai_planner_output_cost_micros_per_million_tokens: int = 4_500_000

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
        if self.ai_planner_enabled:
            if self.ai_planner_provider != "gemini":
                raise ValueError("AI_PLANNER_PROVIDER must be gemini")
            if not self.gemini_api_key:
                raise ValueError("GEMINI_API_KEY is required when AI planner is enabled")
            if self.app_env != "development" and not self.rate_limit_enabled:
                raise ValueError(
                    "RATE_LIMIT_ENABLED must be true when AI planner is enabled outside development"
                )
            if self.ai_planner_data_tier == "unpaid" and not self.ai_planner_allowed_subject_set:
                raise ValueError(
                    "AI_PLANNER_ALLOWED_SUBJECTS is required for unpaid Gemini usage"
                )
        if self.ai_planner_data_tier not in {"paid", "unpaid"}:
            raise ValueError("AI_PLANNER_DATA_TIER must be paid or unpaid")
        positive_ai_settings = {
            "AI_PLANNER_TIMEOUT_SECONDS": self.ai_planner_timeout_seconds,
            "AI_PLANNER_MAX_OUTPUT_TOKENS": self.ai_planner_max_output_tokens,
            "AI_PLANNER_RATE_LIMIT_CAPACITY": self.ai_planner_rate_limit_capacity,
            "AI_PLANNER_RATE_LIMIT_REFILL_PER_SECOND": (
                self.ai_planner_rate_limit_refill_per_second
            ),
            "AI_PLANNER_DAILY_QUOTA": self.ai_planner_daily_quota,
            "AI_PLANNER_MONTHLY_COST_LIMIT_CENTS": (
                self.ai_planner_monthly_cost_limit_cents
            ),
            "AI_PLANNER_INPUT_COST_MICROS_PER_MILLION_TOKENS": (
                self.ai_planner_input_cost_micros_per_million_tokens
            ),
            "AI_PLANNER_OUTPUT_COST_MICROS_PER_MILLION_TOKENS": (
                self.ai_planner_output_cost_micros_per_million_tokens
            ),
        }
        for name, value in positive_ai_settings.items():
            if value <= 0:
                raise ValueError(f"{name} must be greater than zero")
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
            try:
                alert_url = httpx.URL(self.operations_alert_webhook_url)
            except httpx.InvalidURL as error:
                raise ValueError(
                    "OPERATIONS_ALERT_WEBHOOK_URL must be a valid absolute URL"
                ) from error
            if not alert_url.is_absolute_url:
                raise ValueError(
                    "OPERATIONS_ALERT_WEBHOOK_URL must be a valid absolute URL"
                )
            if self.app_env != "development" and alert_url.scheme != "https":
                raise ValueError(
                    "OPERATIONS_ALERT_WEBHOOK_URL must use HTTPS outside development"
                )

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @property
    def ai_planner_allowed_subject_set(self) -> set[str]:
        return {
            subject.strip()
            for subject in self.ai_planner_allowed_subjects.split(",")
            if subject.strip()
        }
