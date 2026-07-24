import hashlib
import hmac
import logging
import math
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address

from fastapi import Depends, HTTPException, Request, Response
from redis.asyncio import Redis
from redis.exceptions import RedisError

from .auth import CurrentUser, current_user
from .config import Settings
from .rate_limit_alerts import RateLimitAlertObserver


logger = logging.getLogger("fairway.rate_limit")


TOKEN_BUCKET_LUA = """
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])
local now_parts = redis.call('TIME')
local now_ms = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = tonumber(state[1]) or capacity
local updated_at = tonumber(state[2]) or now_ms
tokens = math.min(capacity, tokens + math.max(0, now_ms - updated_at) * refill_per_ms)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now_ms)
redis.call('PEXPIRE', KEYS[1], ttl_ms)
local retry_ms = 0
if allowed == 0 then
  retry_ms = math.ceil((cost - tokens) / refill_per_ms)
end
local reset_ms = math.ceil((capacity - tokens) / refill_per_ms)
return {allowed, math.floor(tokens), retry_ms, reset_ms}
"""


FIXED_QUOTA_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local ttl_ms = redis.call('PTTL', KEYS[1])
local allowed = 0
if current <= tonumber(ARGV[1]) then
  allowed = 1
end
return {allowed, current, ttl_ms}
"""


@dataclass(frozen=True)
class RateLimitPolicy:
    name: str
    capacity: int
    refill_per_second: float
    cost: int = 1
    fail_closed: bool = False


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after: float
    reset_after: float


class RateLimiter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._redis: Redis | None = None
        self._alerts = RateLimitAlertObserver(settings)

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()

    async def token_bucket(
        self, *, policy: RateLimitPolicy, identity_type: str, identity: str
    ) -> RateLimitDecision | None:
        if not self.settings.rate_limit_enabled:
            return None
        refill_per_ms = policy.refill_per_second / 1000
        ttl_ms = max(
            60_000,
            math.ceil((policy.capacity / policy.refill_per_second) * 2000),
        )
        key = self._key("bucket", policy.name, identity_type, identity)
        try:
            result = await self._client().eval(
                TOKEN_BUCKET_LUA,
                1,
                key,
                policy.capacity,
                refill_per_ms,
                policy.cost,
                ttl_ms,
            )
        except (RedisError, OSError) as error:
            return await self._failure(policy, error)
        decision = RateLimitDecision(
            allowed=bool(int(result[0])),
            limit=policy.capacity,
            remaining=max(0, int(result[1])),
            retry_after=max(0, int(result[2])) / 1000,
            reset_after=max(0, int(result[3])) / 1000,
        )
        if not decision.allowed:
            await self._alerts.record_denial(
                policy=policy.name,
                identity_type=identity_type,
                abuse_id=self._identity_digest(identity)[:12],
            )
        return decision

    async def daily_quota(
        self,
        *,
        name: str,
        limit: int,
        identity_type: str,
        identity: str,
        fail_closed: bool = False,
    ) -> RateLimitDecision | None:
        if not self.settings.rate_limit_enabled:
            return None
        now = datetime.now(UTC)
        tomorrow = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        ttl_ms = max(1000, math.ceil((tomorrow - now).total_seconds() * 1000))
        key = self._key("quota", name, now.date().isoformat(), identity_type, identity)
        try:
            result = await self._client().eval(
                FIXED_QUOTA_LUA, 1, key, limit, ttl_ms
            )
        except (RedisError, OSError) as error:
            policy = RateLimitPolicy(name, limit, 1 / 86_400, fail_closed=fail_closed)
            return await self._failure(policy, error)
        used = int(result[1])
        reset_after = max(0, int(result[2])) / 1000
        decision = RateLimitDecision(
            allowed=bool(int(result[0])),
            limit=limit,
            remaining=max(0, limit - used),
            retry_after=reset_after if used > limit else 0,
            reset_after=reset_after,
        )
        if not decision.allowed:
            await self._alerts.record_denial(
                policy=name,
                identity_type=identity_type,
                abuse_id=self._identity_digest(identity)[:12],
            )
        return decision

    def _client(self) -> Redis:
        if self._redis is None:
            assert self.settings.redis_url is not None
            self._redis = Redis.from_url(
                self.settings.redis_url,
                decode_responses=False,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
        return self._redis

    def _key(self, namespace: str, *parts: str) -> str:
        raw_identity = parts[-1]
        digest = self._identity_digest(raw_identity)
        return ":".join(("fairway", namespace, *parts[:-1], digest))

    def _identity_digest(self, identity: str) -> str:
        return hmac.new(
            self.settings.rate_limit_key_salt.encode(),
            identity.encode(),
            hashlib.sha256,
        ).hexdigest()

    async def _failure(
        self, policy: RateLimitPolicy, error: Exception
    ) -> RateLimitDecision | None:
        logger.error(
            "rate_limit_backend_unavailable policy=%s fail_closed=%s error_type=%s",
            policy.name,
            policy.fail_closed,
            type(error).__name__,
        )
        await self._alerts.record_backend_failure(
            policy=policy.name,
            fail_closed=policy.fail_closed,
            error_type=type(error).__name__,
        )
        if policy.fail_closed:
            raise HTTPException(503, "Request capacity is temporarily unavailable") from error
        return None


async def public_rate_limit(request: Request, response: Response) -> None:
    settings = request.app.state.settings
    decision = await request.app.state.rate_limiter.token_bucket(
        policy=RateLimitPolicy(
            "public",
            settings.public_rate_limit_capacity,
            settings.public_rate_limit_refill_per_second,
        ),
        identity_type="ip",
        identity=client_ip(request, settings),
    )
    apply_rate_limit(response, decision)


async def readiness_rate_limit(request: Request, response: Response) -> None:
    settings = request.app.state.settings
    decision = await request.app.state.rate_limiter.token_bucket(
        policy=RateLimitPolicy(
            "readiness",
            settings.readiness_rate_limit_capacity,
            settings.readiness_rate_limit_refill_per_second,
        ),
        identity_type="ip",
        identity=client_ip(request, settings),
    )
    apply_rate_limit(response, decision)


async def authenticated_rate_limit(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(current_user),
) -> None:
    settings = request.app.state.settings
    is_write = request.method not in {"GET", "HEAD", "OPTIONS"}
    policy = RateLimitPolicy(
        "authenticated-write" if is_write else "authenticated-read",
        settings.authenticated_write_capacity
        if is_write
        else settings.authenticated_read_capacity,
        settings.authenticated_write_refill_per_second
        if is_write
        else settings.authenticated_read_refill_per_second,
    )
    decision = await request.app.state.rate_limiter.token_bucket(
        policy=policy,
        identity_type="user",
        identity=user.provider_subject,
    )
    apply_rate_limit(response, decision)


async def candidate_rate_limit(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(current_user),
) -> None:
    settings = request.app.state.settings
    policy = RateLimitPolicy(
        "course-candidate",
        settings.candidate_rate_limit_capacity,
        settings.candidate_rate_limit_refill_per_second,
    )
    for identity_type, identity in (
        ("user", user.provider_subject),
        ("ip", client_ip(request, settings)),
    ):
        decision = await request.app.state.rate_limiter.token_bucket(
            policy=policy,
            identity_type=identity_type,
            identity=identity,
        )
        apply_rate_limit(response, decision)
    quota = await request.app.state.rate_limiter.daily_quota(
        name="course-candidate",
        limit=settings.candidate_daily_quota,
        identity_type="user",
        identity=user.provider_subject,
    )
    apply_rate_limit(response, quota)


async def ai_planner_rate_limit(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(current_user),
) -> None:
    settings = request.app.state.settings
    if not settings.ai_planner_enabled:
        return
    allowed_subjects = settings.ai_planner_allowed_subject_set
    if allowed_subjects and user.provider_subject not in allowed_subjects:
        return
    policy = RateLimitPolicy(
        "ai-planner",
        settings.ai_planner_rate_limit_capacity,
        settings.ai_planner_rate_limit_refill_per_second,
        fail_closed=True,
    )
    for identity_type, identity in (
        ("user", user.provider_subject),
        ("ip", client_ip(request, settings)),
    ):
        decision = await request.app.state.rate_limiter.token_bucket(
            policy=policy,
            identity_type=identity_type,
            identity=identity,
        )
        apply_rate_limit(response, decision)
    quota = await request.app.state.rate_limiter.daily_quota(
        name="ai-planner",
        limit=settings.ai_planner_daily_quota,
        identity_type="user",
        identity=user.provider_subject,
        fail_closed=True,
    )
    apply_rate_limit(response, quota)


def client_ip(request: Request, settings: Settings) -> str:
    direct = request.client.host if request.client is not None else "unknown"
    if settings.trusted_client_ip_header:
        candidates = request.headers.getlist(settings.trusted_client_ip_header)
        if len(candidates) == 1:
            try:
                return str(ip_address(candidates[0].strip()))
            except ValueError:
                pass
    return direct


def apply_rate_limit(
    response: Response, decision: RateLimitDecision | None
) -> None:
    if decision is None:
        return
    headers = rate_limit_headers(decision)
    if not decision.allowed:
        raise HTTPException(
            429,
            "Too many requests",
            headers={**headers, "Retry-After": str(max(1, math.ceil(decision.retry_after)))},
        )
    response.headers.update(headers)


def rate_limit_headers(decision: RateLimitDecision) -> dict[str, str]:
    return {
        "X-RateLimit-Limit": str(decision.limit),
        "X-RateLimit-Remaining": str(decision.remaining),
        "X-RateLimit-Reset": str(math.ceil(time.time() + decision.reset_after)),
    }
