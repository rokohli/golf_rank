from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    allow_development_identity: bool = True
    database_url: str = "sqlite+pysqlite://"

    def validate_security(self) -> None:
        if self.app_env != "development" and self.allow_development_identity:
            raise ValueError("ALLOW_DEVELOPMENT_IDENTITY is development-only")
