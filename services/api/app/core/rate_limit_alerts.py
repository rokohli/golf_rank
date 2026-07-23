import asyncio
import logging
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable

import httpx

from .config import Settings


logger = logging.getLogger("fairway.rate_limit")

AlertPayload = dict[str, object]
AlertSender = Callable[[AlertPayload], Awaitable[None]]


class RateLimitAlertObserver:
    def __init__(
        self,
        settings: Settings,
        *,
        clock: Callable[[], float] = time.monotonic,
        sender: AlertSender | None = None,
    ) -> None:
        self.settings = settings
        self._clock = clock
        self._sender = sender or self._send_webhook
        self._events: OrderedDict[str, deque[float]] = OrderedDict()
        self._last_alert: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def record_backend_failure(
        self, *, policy: str, fail_closed: bool, error_type: str
    ) -> None:
        await self._record(
            event="rate_limit_backend_failures",
            key=f"backend:{policy}",
            policy=policy,
            threshold=self.settings.rate_limit_backend_failure_alert_threshold,
            context={"fail_closed": fail_closed, "error_type": error_type},
        )

    async def record_denial(
        self, *, policy: str, identity_type: str, abuse_id: str
    ) -> None:
        logger.warning(
            "rate_limit_denied policy=%s identity_type=%s abuse_id=%s",
            policy,
            identity_type,
            abuse_id,
        )
        await self._record(
            event="rate_limit_denial_volume",
            key=f"denial:{policy}",
            policy=policy,
            threshold=self.settings.rate_limit_denial_alert_threshold,
            context={},
        )
        await self._record(
            event="rate_limit_repeated_abuse",
            key=f"identity:{policy}:{identity_type}:{abuse_id}",
            policy=policy,
            threshold=self.settings.rate_limit_identity_alert_threshold,
            context={"identity_type": identity_type, "abuse_id": abuse_id},
        )

    async def _record(
        self,
        *,
        event: str,
        key: str,
        policy: str,
        threshold: int,
        context: AlertPayload,
    ) -> None:
        now = self._clock()
        window = self.settings.rate_limit_alert_window_seconds
        async with self._lock:
            timestamps = self._events.get(key)
            if timestamps is None:
                if len(self._events) >= self.settings.rate_limit_alert_max_tracked_keys:
                    expired_key, _ = self._events.popitem(last=False)
                    self._last_alert.pop(expired_key, None)
                timestamps = deque()
                self._events[key] = timestamps
            else:
                self._events.move_to_end(key)
            while timestamps and timestamps[0] <= now - window:
                timestamps.popleft()
            timestamps.append(now)
            count = len(timestamps)
            last_alert = self._last_alert.get(key)
            if count < threshold or (
                last_alert is not None
                and now - last_alert < self.settings.rate_limit_alert_cooldown_seconds
            ):
                return
            self._last_alert[key] = now

        payload: AlertPayload = {
            "source": "fairway-api",
            "environment": self.settings.app_env,
            "event": event,
            "policy": policy,
            "count": count,
            "window_seconds": window,
            **context,
        }
        logger.critical(
            "rate_limit_alert_triggered event=%s policy=%s count=%s window_seconds=%s",
            event,
            policy,
            count,
            window,
        )
        if self.settings.operations_alert_webhook_url:
            try:
                await self._sender(payload)
            except (httpx.HTTPError, httpx.InvalidURL, OSError) as error:
                logger.error(
                    "rate_limit_alert_delivery_failed event=%s error_type=%s",
                    event,
                    type(error).__name__,
                )

    async def _send_webhook(self, payload: AlertPayload) -> None:
        assert self.settings.operations_alert_webhook_url is not None
        async with httpx.AsyncClient(
            timeout=self.settings.operations_alert_webhook_timeout_seconds
        ) as client:
            response = await client.post(
                self.settings.operations_alert_webhook_url,
                json=payload,
            )
            response.raise_for_status()
