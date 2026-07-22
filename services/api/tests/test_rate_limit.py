import asyncio
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import Settings
from app.core.rate_limit import (
    RateLimitDecision,
    RateLimitPolicy,
    RateLimiter,
)
from app.main import create_app


ENABLED_SETTINGS = Settings(
    rate_limit_enabled=True,
    redis_url="redis://unused:6379",
    rate_limit_key_salt="test-rate-limit-key",
)


class RecordingLimiter:
    def __init__(self, decisions: list[RateLimitDecision | None] | None = None) -> None:
        self.decisions = list(decisions or [])
        self.token_calls: list[dict] = []
        self.quota_calls: list[dict] = []

    async def token_bucket(self, **kwargs):
        self.token_calls.append(kwargs)
        return self.decisions.pop(0) if self.decisions else allowed_decision()

    async def daily_quota(self, **kwargs):
        self.quota_calls.append(kwargs)
        return self.decisions.pop(0) if self.decisions else allowed_decision(limit=5)


def allowed_decision(*, limit: int = 60, remaining: int = 59) -> RateLimitDecision:
    return RateLimitDecision(True, limit, remaining, 0, 1)


def denied_decision(*, limit: int = 60) -> RateLimitDecision:
    return RateLimitDecision(False, limit, 0, 2.2, 60)


def test_public_limit_returns_capacity_headers_and_retry_after() -> None:
    app = create_app(ENABLED_SETTINGS)
    limiter = RecordingLimiter([allowed_decision(), denied_decision()])
    app.state.rate_limiter = limiter
    client = TestClient(app)

    allowed = client.get("/api/v1/courses")
    denied = client.get("/api/v1/courses")

    assert allowed.status_code == 200
    assert allowed.headers["x-ratelimit-limit"] == "60"
    assert allowed.headers["x-ratelimit-remaining"] == "59"
    assert denied.status_code == 429
    assert denied.headers["retry-after"] == "3"
    assert denied.json() == {"detail": "Too many requests"}


def test_authenticated_routes_use_stable_subject_and_separate_read_write_policies() -> None:
    app = create_app(ENABLED_SETTINGS)
    limiter = RecordingLimiter()
    app.state.rate_limiter = limiter
    client = TestClient(app)
    headers = {"X-Development-Subject": "dev:alice"}

    assert client.get("/api/v1/me/profile", headers=headers).status_code == 404
    assert client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 300,
            "difficulty": "any",
            "access": "any",
        },
    ).status_code == 200

    assert [call["policy"].name for call in limiter.token_calls] == [
        "authenticated-read",
        "authenticated-write",
    ]
    assert {call["identity"] for call in limiter.token_calls} == {"dev:alice"}


def test_candidate_submission_checks_user_ip_and_daily_quota() -> None:
    app = create_app(ENABLED_SETTINGS)
    limiter = RecordingLimiter()
    app.state.rate_limiter = limiter
    client = TestClient(app)

    response = client.post(
        "/api/v1/course-candidates",
        headers={"X-Development-Subject": "dev:missing-user"},
        json={"name": "Missing Links"},
    )

    assert response.status_code == 404
    assert [call["identity_type"] for call in limiter.token_calls] == ["user", "ip"]
    assert limiter.quota_calls[0]["identity"] == "dev:missing-user"


def test_forwarded_header_is_ignored_unless_render_proxy_trust_is_enabled() -> None:
    untrusted_app = create_app(ENABLED_SETTINGS)
    untrusted_limiter = RecordingLimiter()
    untrusted_app.state.rate_limiter = untrusted_limiter
    trusted_settings = ENABLED_SETTINGS.model_copy(
        update={"trust_render_forwarded_for": True}
    )
    trusted_app = create_app(trusted_settings)
    trusted_limiter = RecordingLimiter()
    trusted_app.state.rate_limiter = trusted_limiter

    TestClient(untrusted_app).get(
        "/api/v1/courses", headers={"X-Forwarded-For": "198.51.100.2, 10.0.0.1"}
    )
    TestClient(trusted_app).get(
        "/api/v1/courses", headers={"X-Forwarded-For": "198.51.100.2, 10.0.0.1"}
    )

    assert untrusted_limiter.token_calls[0]["identity"] == "testclient"
    assert trusted_limiter.token_calls[0]["identity"] == "198.51.100.2"

    invalid_limiter = RecordingLimiter()
    trusted_app.state.rate_limiter = invalid_limiter
    TestClient(trusted_app).get(
        "/api/v1/courses", headers={"X-Forwarded-For": "not-an-ip"}
    )
    assert invalid_limiter.token_calls[0]["identity"] == "testclient"


def test_redis_failure_opens_ordinary_requests_and_closes_cost_bearing_requests() -> None:
    async def exercise() -> None:
        limiter = RateLimiter(ENABLED_SETTINGS)
        limiter._redis = FailingRedis()  # type: ignore[assignment]

        assert await limiter.token_bucket(
            policy=RateLimitPolicy("ordinary", 10, 1),
            identity_type="user",
            identity="dev:alice",
        ) is None
        with pytest.raises(Exception) as captured:
            await limiter.token_bucket(
                policy=RateLimitPolicy("cost-bearing", 10, 1, fail_closed=True),
                identity_type="user",
                identity="dev:alice",
            )
        assert getattr(captured.value, "status_code", None) == 503

    asyncio.run(exercise())


def test_limiter_keys_are_hmac_hashed() -> None:
    async def exercise() -> None:
        limiter = RateLimiter(ENABLED_SETTINGS)
        redis = RecordingRedis()
        limiter._redis = redis  # type: ignore[assignment]

        await limiter.token_bucket(
            policy=RateLimitPolicy("private", 10, 1),
            identity_type="user",
            identity="clerk:user-secret-123",
        )

        assert redis.key is not None
        assert "clerk:user-secret-123" not in redis.key

    asyncio.run(exercise())


@pytest.mark.skipif(not os.getenv("REDIS_TEST_URL"), reason="REDIS_TEST_URL is not configured")
def test_lua_bucket_is_atomic_weighted_and_isolated_across_identities() -> None:
    async def exercise() -> None:
        settings = ENABLED_SETTINGS.model_copy(
            update={"redis_url": os.environ["REDIS_TEST_URL"]}
        )
        limiter = RateLimiter(settings)
        identity = f"concurrent-{uuid4()}"
        policy = RateLimitPolicy("concurrency", capacity=5, refill_per_second=0.001)
        decisions = await asyncio.gather(*[
            limiter.token_bucket(
                policy=policy,
                identity_type="user",
                identity=identity,
            )
            for _ in range(20)
        ])

        assert sum(decision.allowed for decision in decisions if decision is not None) == 5
        isolated = await limiter.token_bucket(
            policy=policy,
            identity_type="user",
            identity=f"other-{uuid4()}",
        )
        assert isolated is not None and isolated.allowed

        weighted_identity = f"weighted-{uuid4()}"
        weighted = RateLimitPolicy(
            "weighted", capacity=5, refill_per_second=0.001, cost=3
        )
        first = await limiter.token_bucket(
            policy=weighted,
            identity_type="user",
            identity=weighted_identity,
        )
        second = await limiter.token_bucket(
            policy=weighted,
            identity_type="user",
            identity=weighted_identity,
        )
        assert first is not None and first.allowed and first.remaining == 2
        assert second is not None and not second.allowed

        refill_identity = f"refill-{uuid4()}"
        refill_policy = RateLimitPolicy(
            "refill", capacity=2, refill_per_second=20
        )
        refill_results = [
            await limiter.token_bucket(
                policy=refill_policy,
                identity_type="user",
                identity=refill_identity,
            )
            for _ in range(3)
        ]
        assert [decision.allowed for decision in refill_results if decision] == [
            True,
            True,
            False,
        ]
        assert refill_results[-1] is not None and refill_results[-1].retry_after > 0
        await asyncio.sleep(0.06)
        refilled = await limiter.token_bucket(
            policy=refill_policy,
            identity_type="user",
            identity=refill_identity,
        )
        assert refilled is not None and refilled.allowed

        quota_identity = f"quota-{uuid4()}"
        quotas = [
            await limiter.daily_quota(
                name="daily-test",
                limit=2,
                identity_type="user",
                identity=quota_identity,
            )
            for _ in range(3)
        ]
        assert [decision.allowed for decision in quotas if decision] == [
            True,
            True,
            False,
        ]
        assert quotas[-1] is not None and quotas[-1].retry_after > 0
        await limiter.close()

    asyncio.run(exercise())


class FailingRedis:
    async def eval(self, *_args):
        raise RedisConnectionError("offline")


class RecordingRedis:
    def __init__(self) -> None:
        self.key: str | None = None

    async def eval(self, _script, _key_count, key, *_args):
        self.key = key
        return [1, 9, 0, 1000]
