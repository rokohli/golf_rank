import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import Settings
from app.core.rate_limit import (
    RateLimitDecision,
    RateLimitPolicy,
    RateLimiter,
)
from app.core.rate_limit_alerts import RateLimitAlertObserver
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


def test_ai_planner_checks_user_ip_and_fail_closed_daily_quota() -> None:
    settings = ENABLED_SETTINGS.model_copy(update={
        "ai_planner_enabled": True,
        "gemini_api_key": "test-key",
    })
    app = create_app(settings)
    limiter = RecordingLimiter()
    app.state.rate_limiter = limiter
    app.state.planner_narrative_provider = None
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/plans",
        headers={"X-Development-Subject": "dev:ai-limit"},
        json={
            "title": "AI limit",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "regions": ["Monterey"],
        },
    ).json()
    limiter.token_calls.clear()
    limiter.quota_calls.clear()

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary",
        headers={"X-Development-Subject": "dev:ai-limit"},
    )

    assert response.status_code == 200
    assert [call["policy"].name for call in limiter.token_calls] == [
        "authenticated-write",
        "ai-planner",
        "ai-planner",
    ]
    assert [call["identity_type"] for call in limiter.token_calls[1:]] == ["user", "ip"]
    assert limiter.quota_calls == [{
        "name": "ai-planner",
        "limit": 25,
        "identity_type": "user",
        "identity": "dev:ai-limit",
        "fail_closed": True,
    }]


def test_client_ip_uses_only_explicitly_trusted_single_ip_header() -> None:
    untrusted_app = create_app(ENABLED_SETTINGS)
    untrusted_limiter = RecordingLimiter()
    untrusted_app.state.rate_limiter = untrusted_limiter
    trusted_settings = ENABLED_SETTINGS.model_copy(
        update={"trusted_client_ip_header": "cf-connecting-ip"}
    )
    trusted_app = create_app(trusted_settings)
    trusted_limiter = RecordingLimiter()
    trusted_app.state.rate_limiter = trusted_limiter

    TestClient(untrusted_app).get(
        "/api/v1/courses",
        headers={"CF-Connecting-IP": "198.51.100.2"},
    )
    TestClient(trusted_app).get(
        "/api/v1/courses",
        headers={
            "CF-Connecting-IP": "198.51.100.2",
            "X-Forwarded-For": "203.0.113.99",
        },
    )

    assert untrusted_limiter.token_calls[0]["identity"] == "testclient"
    assert trusted_limiter.token_calls[0]["identity"] == "198.51.100.2"

    invalid_limiter = RecordingLimiter()
    trusted_app.state.rate_limiter = invalid_limiter
    TestClient(trusted_app).get(
        "/api/v1/courses", headers={"CF-Connecting-IP": "not-an-ip, 10.0.0.1"}
    )
    assert invalid_limiter.token_calls[0]["identity"] == "testclient"

    duplicate_limiter = RecordingLimiter()
    trusted_app.state.rate_limiter = duplicate_limiter
    TestClient(trusted_app).get(
        "/api/v1/courses",
        headers=[
            ("CF-Connecting-IP", "198.51.100.2"),
            ("CF-Connecting-IP", "203.0.113.99"),
        ],
    )
    assert duplicate_limiter.token_calls[0]["identity"] == "testclient"


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


def test_denial_observation_receives_only_a_truncated_identity_digest() -> None:
    async def exercise() -> None:
        limiter = RateLimiter(ENABLED_SETTINGS)
        limiter._redis = DenyingRedis()  # type: ignore[assignment]
        alerts = RecordingAlerts()
        limiter._alerts = alerts  # type: ignore[assignment]

        decision = await limiter.token_bucket(
            policy=RateLimitPolicy("private", 10, 1),
            identity_type="user",
            identity="clerk:user-secret-123",
        )

        assert decision is not None and not decision.allowed
        assert alerts.denials == [
            {
                "policy": "private",
                "identity_type": "user",
                "abuse_id": limiter._identity_digest("clerk:user-secret-123")[:12],
            }
        ]
        assert "clerk:user-secret-123" not in str(alerts.denials)

    asyncio.run(exercise())


def test_denial_alerts_are_thresholded_deduplicated_and_privacy_safe(caplog) -> None:
    async def exercise() -> None:
        now = [100.0]
        payloads: list[dict[str, object]] = []

        async def send(payload: dict[str, object]) -> None:
            payloads.append(payload)

        settings = ENABLED_SETTINGS.model_copy(
            update={
                "app_env": "staging",
                "operations_alert_webhook_url": "https://alerts.example.test/fairway",
                "rate_limit_denial_alert_threshold": 2,
                "rate_limit_identity_alert_threshold": 2,
                "rate_limit_alert_window_seconds": 30,
                "rate_limit_alert_cooldown_seconds": 60,
            }
        )
        observer = RateLimitAlertObserver(
            settings,
            clock=lambda: now[0],
            sender=send,
        )

        for _ in range(3):
            await observer.record_denial(
                policy="authenticated-read",
                identity_type="user",
                abuse_id="a1b2c3d4e5f6",
            )

        assert {payload["event"] for payload in payloads} == {
            "rate_limit_denial_volume",
            "rate_limit_repeated_abuse",
        }
        assert all(payload["count"] == 2 for payload in payloads)
        assert payloads[1]["abuse_id"] == "a1b2c3d4e5f6"
        assert "clerk:user-secret" not in caplog.text
        assert len(payloads) == 2

    asyncio.run(exercise())


def test_backend_failure_alert_contains_only_bounded_error_metadata() -> None:
    async def exercise() -> None:
        payloads: list[dict[str, object]] = []

        async def send(payload: dict[str, object]) -> None:
            payloads.append(payload)

        settings = ENABLED_SETTINGS.model_copy(
            update={
                "app_env": "staging",
                "operations_alert_webhook_url": "https://alerts.example.test/fairway",
                "rate_limit_backend_failure_alert_threshold": 2,
            }
        )
        observer = RateLimitAlertObserver(settings, sender=send)

        for _ in range(2):
            await observer.record_backend_failure(
                policy="public",
                fail_closed=False,
                error_type="ConnectionError",
            )

        assert payloads == [
            {
                "source": "fairway-api",
                "environment": "staging",
                "event": "rate_limit_backend_failures",
                "policy": "public",
                "count": 2,
                "window_seconds": 300,
                "fail_closed": False,
                "error_type": "ConnectionError",
            }
        ]

    asyncio.run(exercise())


def test_alert_delivery_invalid_url_is_logged_without_escaping(monkeypatch) -> None:
    logged_errors: list[tuple] = []
    monkeypatch.setattr(
        "app.core.rate_limit_alerts.logger.error",
        lambda *args: logged_errors.append(args),
    )

    async def exercise() -> None:
        async def fail_delivery(_payload: dict[str, object]) -> None:
            raise httpx.InvalidURL("invalid receiver")

        settings = ENABLED_SETTINGS.model_copy(
            update={
                "app_env": "staging",
                "operations_alert_webhook_url": "https://alerts.example.test/fairway",
                "rate_limit_backend_failure_alert_threshold": 1,
            }
        )
        observer = RateLimitAlertObserver(settings, sender=fail_delivery)

        await observer.record_backend_failure(
            policy="public",
            fail_closed=False,
            error_type="ConnectionError",
        )

        assert logged_errors == [
            (
                "rate_limit_alert_delivery_failed event=%s error_type=%s",
                "rate_limit_backend_failures",
                "InvalidURL",
            )
        ]

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


class DenyingRedis:
    async def eval(self, *_args):
        return [0, 0, 1000, 10_000]


class RecordingAlerts:
    def __init__(self) -> None:
        self.denials: list[dict] = []

    async def record_denial(self, **kwargs) -> None:
        self.denials.append(kwargs)
