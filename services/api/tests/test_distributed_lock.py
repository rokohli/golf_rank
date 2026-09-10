import os
import time
from uuid import uuid4

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import Settings
from app.core.distributed_lock import RedisLock


def _settings(**overrides) -> Settings:
    base = dict(redis_url="redis://localhost:6379/15", rate_limit_key_salt="x" * 32)
    base.update(overrides)
    return Settings(**base)


class _FakeRedis:
    """Enough of the client for the lock: SET NX PX plus the release script."""

    def __init__(self, *, fail: bool = False) -> None:
        self.store: dict[str, bytes] = {}
        self.fail = fail
        self.calls = 0

    def set(self, key, value, nx=False, px=None):
        self.calls += 1
        if self.fail:
            raise RedisConnectionError("redis is down")
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def eval(self, _script, _numkeys, key, token):
        self.calls += 1
        if self.fail:
            raise RedisConnectionError("redis is down")
        if self.store.get(key) == token:
            del self.store[key]
            return 1
        return 0

    def close(self):
        pass


def _lock(client: _FakeRedis, **kwargs) -> RedisLock:
    lock = RedisLock(_settings(), **kwargs)
    lock._client = client
    return lock


# --- core behavior --------------------------------------------------------


def test_a_second_holder_is_refused_and_the_first_releases() -> None:
    client = _FakeRedis()
    lock = _lock(client)

    with lock.try_lock("course-1", ttl_seconds=5) as first:
        assert first is True
        with lock.try_lock("course-1", ttl_seconds=5) as second:
            assert second is False

    # Released on exit, so the next caller gets it.
    with lock.try_lock("course-1", ttl_seconds=5) as third:
        assert third is True


def test_different_names_do_not_contend() -> None:
    lock = _lock(_FakeRedis())

    with lock.try_lock("course-1", ttl_seconds=5) as first:
        with lock.try_lock("course-2", ttl_seconds=5) as second:
            assert first is True and second is True


def test_release_is_token_scoped() -> None:
    """A holder whose TTL expired must not delete the lock another process now
    owns -- which a plain DEL would do."""
    client = _FakeRedis()
    lock = _lock(client)

    with lock.try_lock("course-1", ttl_seconds=5):
        key = next(iter(client.store))
        # Simulate the TTL expiring and another process taking the lock.
        client.store[key] = b"someone-elses-token"

    assert client.store[key] == b"someone-elses-token"


def test_keys_do_not_leak_the_lock_name() -> None:
    client = _FakeRedis()
    lock = _lock(client)

    with lock.try_lock("course-image-wikimedia:12345", ttl_seconds=5):
        key = next(iter(client.store))

    assert "12345" not in key
    assert key.startswith("fairway:lock:")


# --- failing open ---------------------------------------------------------


def test_an_unreachable_redis_yields_true() -> None:
    """The lock only deduplicates work, so its absence must never stop it."""
    lock = _lock(_FakeRedis(fail=True))

    with lock.try_lock("course-1", ttl_seconds=5) as acquired:
        assert acquired is True


def test_no_redis_url_configured_yields_true_without_a_client() -> None:
    lock = RedisLock(Settings(redis_url=None))

    assert lock.enabled is False
    with lock.try_lock("course-1", ttl_seconds=5) as acquired:
        assert acquired is True


def test_the_breaker_opens_and_stops_calling_redis() -> None:
    """Without this, a Redis outage would add a connect timeout to every
    cold-cache request."""
    client = _FakeRedis(fail=True)
    lock = _lock(client, failure_threshold=3, cooldown_seconds=60)

    for _ in range(3):
        with lock.try_lock("course-1", ttl_seconds=5):
            pass
    calls_at_open = client.calls

    for _ in range(5):
        with lock.try_lock("course-1", ttl_seconds=5) as acquired:
            assert acquired is True

    assert client.calls == calls_at_open, "breaker should short-circuit Redis entirely"


def test_the_breaker_closes_after_the_cooldown() -> None:
    client = _FakeRedis(fail=True)
    lock = _lock(client, failure_threshold=1, cooldown_seconds=0.05)

    with lock.try_lock("course-1", ttl_seconds=5):
        pass
    calls_while_open = client.calls
    time.sleep(0.06)
    client.fail = False

    with lock.try_lock("course-1", ttl_seconds=5) as acquired:
        assert acquired is True
        # Held here; the key is deleted again on exit, so count calls rather
        # than inspecting the store.
        assert client.store, "should hold the key while inside the lock"
    assert client.calls > calls_while_open, "should have reached Redis again after the cooldown"


def test_failure_count_distinguishes_contention_from_unavailability() -> None:
    client = _FakeRedis()
    lock = _lock(client)

    before = lock.failure_count
    with lock.try_lock("course-1", ttl_seconds=5):
        with lock.try_lock("course-1", ttl_seconds=5) as second:
            assert second is False
    # Losing the race is a real answer, not a degraded one.
    assert lock.failure_count == before

    client.fail = True
    with lock.try_lock("course-2", ttl_seconds=5):
        pass
    assert lock.failure_count > before


# --- against a real Redis -------------------------------------------------


@pytest.mark.skipif(not os.getenv("REDIS_TEST_URL"), reason="REDIS_TEST_URL is not configured")
def test_real_redis_enforces_exclusion_and_sets_a_ttl() -> None:
    import redis

    url = os.environ["REDIS_TEST_URL"]
    lock = RedisLock(_settings(redis_url=url))
    raw = redis.Redis.from_url(url)
    name = f"course-{uuid4()}"

    with lock.try_lock(name, ttl_seconds=5) as first:
        assert first is True
        key = lock._key(name)
        ttl_ms = raw.pttl(key)
        # A lock with no expiry would survive a crashed holder forever.
        assert 0 < ttl_ms <= 5000

        other = RedisLock(_settings(redis_url=url))
        with other.try_lock(name, ttl_seconds=5) as second:
            assert second is False
        other.close()

    assert raw.exists(lock._key(name)) == 0
    lock.close()
    raw.close()
