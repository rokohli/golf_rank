"""Best-effort cross-process coalescing via Redis.

NOT a mutual-exclusion primitive. Nothing here is safe to build correctness on:
the lock can vanish at any moment, and callers must stay correct when two
processes hold it simultaneously. It exists only so that N worker processes
seeing the same cold cache entry don't all make the same outbound provider
call. Redlock semantics this is not.

That weakness is deliberate, because the deployed store can't offer more. The
production Redis is a free-plan key-value service with allkeys-lru eviction and
persistence off, so a key can disappear mid-hold, and a restart drops every
lock at once. The cost of that is one duplicated provider call -- exactly what
the code already does today across processes -- so it is not worth paying for
anything stronger.

Uses the SYNCHRONOUS redis client, unlike core/rate_limit.py's asyncio one.
The caller (CourseImageService.resolve_hero_image) is a plain def running on
Starlette's threadpool, and redis.asyncio binds its connection pool to the
event loop that created it: driving it from a threadpool thread would mean a
fresh event loop, and a fresh TCP connect, on every course-detail request.
"""

import hashlib
import hmac
import logging
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Iterator

import redis
from redis.exceptions import RedisError

from .config import Settings

logger = logging.getLogger("golfrank.distributed_lock")

# Compare-and-delete. A plain DEL would let a caller whose TTL already expired
# delete the lock a *different* process now holds.
_RELEASE_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class RedisLock:
    """Cross-process coalescing with a circuit breaker.

    Every operation fails open: when Redis is unreachable the caller proceeds
    as though it holds the lock, degrading to whatever per-process coalescing
    it already has. Failing closed would let a Redis outage stop the work the
    lock is merely optimizing.
    """

    def __init__(
        self, settings: Settings, *,
        failure_threshold: int = 3,
        cooldown_seconds: float = 30.0,
    ) -> None:
        self._settings = settings
        self._client: redis.Redis | None = None
        self._lock = threading.Lock()
        # Without a breaker, a Redis outage would add a connect timeout to
        # every cold-cache request -- turning a best-effort optimization into a
        # latency incident.
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._consecutive_failures = 0
        self._total_failures = 0
        self._breaker_open_until = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self._settings.redis_url)

    @property
    def failure_count(self) -> int:
        """Total Redis failures observed. Callers compare it across a call to
        tell "another process holds the lock" (a real answer) from "Redis
        didn't answer" (a degraded one), since try_lock reports both as a
        permissive True/False and never raises."""
        with self._lock:
            return self._total_failures

    def _get_client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._settings.redis_url,
                decode_responses=False,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
        return self._client

    def _breaker_is_open(self) -> bool:
        with self._lock:
            return time.monotonic() < self._breaker_open_until

    def _record_failure(self) -> None:
        with self._lock:
            self._consecutive_failures += 1
            self._total_failures += 1
            if self._consecutive_failures >= self._failure_threshold:
                self._breaker_open_until = time.monotonic() + self._cooldown_seconds
                logger.warning(
                    "distributed_lock_breaker_open failures=%s cooldown=%ss",
                    self._consecutive_failures, self._cooldown_seconds,
                )

    def _record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0

    def _key(self, name: str) -> str:
        # Same salted-digest convention as RateLimiter._key, so lock keys don't
        # expose course ids to anyone reading the keyspace.
        digest = hmac.new(
            self._settings.rate_limit_key_salt.encode(), name.encode(), hashlib.sha256
        ).hexdigest()
        return f"fairway:lock:{digest}"

    @contextmanager
    def try_lock(self, name: str, *, ttl_seconds: float) -> Iterator[bool]:
        """Yields True when the caller should do the work.

        Yields True (not False) whenever Redis is unavailable or disabled: the
        lock is an optimization, so its absence must not stop the work.
        Yields False only when another process demonstrably holds the lock.

        Non-blocking by design. Waiting would park a threadpool worker for the
        length of someone else's outbound call, which is the stall this whole
        path exists to avoid.
        """
        if not self.enabled or self._breaker_is_open():
            yield True
            return

        token = uuid.uuid4().hex.encode()
        key = self._key(name)
        acquired = False
        try:
            acquired = bool(
                self._get_client().set(key, token, nx=True, px=int(ttl_seconds * 1000))
            )
            self._record_success()
        except (RedisError, OSError):
            logger.warning("distributed_lock_acquire_failed", exc_info=True)
            self._record_failure()
            yield True
            return

        if not acquired:
            yield False
            return

        try:
            yield True
        finally:
            try:
                self._get_client().eval(_RELEASE_LUA, 1, key, token)
            except (RedisError, OSError):
                # The TTL reclaims it; nothing else to do.
                logger.warning("distributed_lock_release_failed", exc_info=True)
                self._record_failure()

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except (RedisError, OSError):
                pass
            self._client = None
