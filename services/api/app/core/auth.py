from dataclasses import dataclass

from fastapi import Header, HTTPException

from .config import Settings


@dataclass(frozen=True)
class CurrentUser:
    provider_subject: str


def current_user(x_development_subject: str | None = Header(default=None)) -> CurrentUser:
    settings = Settings()
    settings.validate_security()
    if not settings.allow_development_identity:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not x_development_subject or not x_development_subject.startswith("dev:"):
        raise HTTPException(status_code=401, detail="Valid development identity required")
    return CurrentUser(provider_subject=x_development_subject)
