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
    trust_render_forwarded_for: bool = False
    allowed_hosts: str = "testserver,localhost,127.0.0.1"
    max_request_body_bytes: int = 1_048_576
    readiness_cache_seconds: float = 5.0

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

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]
