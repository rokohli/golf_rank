"""OAuth2 client-credentials token management for the Openverse API.

Openverse issues a bearer token via a standard client-credentials grant
(POST openverse_token_url). This caches the token until shortly before it
expires and refreshes it under a lock so concurrent callers don't each pay
their own round trip. Never logs the client secret or the issued token.
"""

import logging
import threading
import time

import httpx

from ...course_photos import request_with_retries

logger = logging.getLogger("golfrank.course_images")

# Refresh this long before the token's stated expiry so a request that starts
# just before expiry doesn't race a 401 against the token's actual cutoff.
_REFRESH_MARGIN_SECONDS = 30.0


class OpenverseTokenManager:
    def __init__(
        self, *, client: httpx.Client, token_url: str, client_id: str, client_secret: str, timeout_seconds: float,
        max_retries: int = 0, retry_budget_seconds: float | None = None,
    ):
        self._client = client
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._timeout_seconds = timeout_seconds
        # 0 (default) for the synchronous live path; batch jobs pass a higher
        # value -- a transient 5xx/429 from Openverse's auth endpoint is exactly
        # as retryable as one from the search endpoint (request_with_retries
        # already retries on 429/500/502/503/504), so this must track the same
        # policy as OpenverseImageProvider's own max_retries, not be hardcoded.
        self._max_retries = max_retries
        # The deadline retries must fit inside. Defaults to timeout_seconds
        # (preserves the live path's tight single-attempt bound); with
        # max_retries > 0 and growing backoff, that default is nowhere near
        # enough time for even one retry to complete -- batch callers must
        # pass a much larger budget alongside a nonzero max_retries, or the
        # retries never actually get a chance to run.
        self._retry_budget_seconds = retry_budget_seconds if retry_budget_seconds is not None else timeout_seconds
        self._lock = threading.Lock()
        self._token: str | None = None
        self._expires_at: float = 0.0

    def get_token(self) -> str:
        """Returns a cached bearer token, refreshing first if it's missing or
        close to expiry."""
        with self._lock:
            if self._token is None or time.monotonic() >= self._expires_at - _REFRESH_MARGIN_SECONDS:
                self._refresh_locked()
            return self._token

    def force_refresh(self) -> str:
        """Discards any cached token and fetches a fresh one -- used when a
        downstream call unexpectedly 401s despite our TTL tracking."""
        with self._lock:
            self._refresh_locked()
            return self._token

    def _refresh_locked(self) -> None:
        try:
            response = request_with_retries(
                self._client, "POST", self._token_url,
                max_retries=self._max_retries, deadline=time.monotonic() + self._retry_budget_seconds,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
            )
            response.raise_for_status()
            payload = response.json()
            self._token = payload["access_token"]
            self._expires_at = time.monotonic() + float(payload["expires_in"])
        except Exception:
            # Never include the request/response body in the log -- it may
            # echo back the client_secret we just sent.
            logger.warning("openverse_token_refresh_failed", exc_info=True)
            raise
