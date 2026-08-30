from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Request
from jwt import PyJWKClient

from .config import Settings


@dataclass(frozen=True)
class CurrentUser:
    provider_subject: str


@lru_cache(maxsize=8)
def jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def verify_clerk_token(token: str, settings: Settings) -> str:
    if not settings.clerk_issuer or not settings.clerk_jwks_url:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        signing_key = jwks_client(settings.clerk_jwks_url).get_signing_key_from_jwt(token)
        options = {"verify_aud": bool(settings.clerk_audience)}
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            audience=settings.clerk_audience,
            options=options,
        )
    except (jwt.PyJWTError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    return subject


def _clerk_user_request(
    method: str, provider_subject: str, settings: Settings, *, ignore_not_found: bool = False
) -> httpx.Response:
    """Call Clerk's Backend API for a single user, wrapping transport/HTTP errors."""
    if not settings.clerk_secret_key:
        raise HTTPException(status_code=503, detail="Identity provider is unavailable")
    subject = provider_subject.removeprefix("clerk:")
    request_fn = httpx.get if method == "GET" else httpx.delete
    try:
        response = request_fn(
            f"https://api.clerk.com/v1/users/{subject}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            timeout=5.0,
        )
        if not (ignore_not_found and response.status_code == 404):
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Identity provider is unavailable") from exc
    return response


def verified_identifiers(current: CurrentUser, settings: Settings) -> tuple[str, ...]:
    """Load verified emails and phones from Clerk's server-side User record."""
    if current.provider_subject.startswith("dev:"):
        return ()
    response = _clerk_user_request("GET", current.provider_subject, settings)
    return _verified_identifiers(response.json())


def _verification_status(entry: dict) -> str | None:
    verification = entry.get("verification")
    if not isinstance(verification, dict):
        return None
    status = verification.get("status")
    return status if isinstance(status, str) else None


def _verified_identifiers(user: dict) -> tuple[str, ...]:
    """Extract only verified identifiers returned by Clerk's Backend API."""
    identifiers: list[str] = []
    for email in user.get("email_addresses", []):
        if isinstance(email, dict) and _verification_status(email) == "verified":
            value = email.get("email_address")
            if isinstance(value, str):
                identifiers.append(value)
    for phone in user.get("phone_numbers", []):
        if isinstance(phone, dict) and _verification_status(phone) == "verified":
            value = phone.get("phone_number")
            if isinstance(value, str):
                identifiers.append(value)
    return tuple(dict.fromkeys(identifiers))


def delete_clerk_user(provider_subject: str, settings: Settings) -> None:
    """Permanently delete the Clerk identity backing an account-deletion request.

    A 404 from Clerk means the identity is already gone (e.g. deleted from the
    Clerk dashboard, or a retry after a prior partial failure) and is treated
    as success so the caller can still clean up its own data.
    """
    if provider_subject.startswith("dev:"):
        return
    _clerk_user_request("DELETE", provider_subject, settings, ignore_not_found=True)


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def current_user(
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_development_subject: str | None = Header(default=None),
) -> CurrentUser:
    settings.validate_security()

    if settings.app_env == "development" and settings.allow_development_identity and x_development_subject:
        if not x_development_subject.startswith("dev:"):
            raise HTTPException(status_code=401, detail="Valid development identity required")
        return CurrentUser(provider_subject=x_development_subject)

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    clerk_subject = verify_clerk_token(authorization.removeprefix("Bearer ").strip(), settings)
    return CurrentUser(provider_subject=f"clerk:{clerk_subject}")
