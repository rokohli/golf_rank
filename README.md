# GolfRank AI

## Local API


```bash
cd services/api
/opt/anaconda3/bin/python -m pip install -e '.[dev]'
/opt/anaconda3/bin/python -m pytest -v
```

The API defaults to SQLite for isolated local tests. Docker Compose runs the production-shaped path with PostgreSQL/PostGIS, Redis, and Alembic migrations. The three deterministic course rows are SQLite test fixtures; development and production catalogs are populated by the explicit import job.

```bash
cp .env.example .env
docker compose up --build
curl http://localhost:8000/health
```

Redis-backed rate limiting is enabled by `.env.example`. Public catalog requests
use IP buckets; authenticated reads and writes use the stable Clerk subject;
course-candidate submissions use user and IP buckets plus a daily quota. Run the
real Lua concurrency test with:

```bash
docker compose up -d redis
cd services/api
REDIS_TEST_URL=redis://localhost:6379/15 pytest -q tests/test_rate_limit.py
```

`TRUSTED_CLIENT_IP_HEADER` is empty by default. Render staging sets it to
`cf-connecting-ip`, which Cloudflare supplies as one validated client address.
The API does not use the caller-controlled `X-Forwarded-For` chain for buckets.

### California course catalog

The MVP catalog imports OpenGolfAPI data under ODbL 1.0. Preview and apply an idempotent import with:

```bash
cd services/api
python -m app.catalog_import --state CA --dry-run
python -m app.catalog_import --state CA
python -m app.catalog_import --onboarding-regions
```

The onboarding-regions mode derives the required state catalogs from users' saved home regions; `--state` remains available for explicit expansion and may be repeated. The job fetches all pages, validates required identity/location fields, upserts by `(source, source_course_id)`, reports errors, and soft-retires provider records omitted from later complete imports. GolfRank must display `Course catalog data © OpenGolfAPI, ODbL 1.0` wherever this catalog is presented.

## Mobile client

```bash
cd apps/frontend
npm install
npm test -- --runInBand
npm start
```

## Authentication modes

Local development can run without a Clerk account:

```bash
EXPO_PUBLIC_AUTH_MODE=development
APP_ENV=development
ALLOW_DEVELOPMENT_IDENTITY=true
```

In this mode, the frontend enters the app immediately and sends:

```http
X-Development-Subject: dev:local-user
```

The API rejects this bypass outside development.

To test real Clerk auth, configure:

```bash
EXPO_PUBLIC_AUTH_MODE=clerk
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<from Clerk dashboard>
CLERK_ISSUER=<from Clerk dashboard>
CLERK_JWKS_URL=<issuer>/.well-known/jwks.json
CLERK_AUDIENCE=fairway-api-staging
ALLOW_DEVELOPMENT_IDENTITY=false
```

Before setting `CLERK_AUDIENCE`, customize Clerk's normal session token under
**Clerk Dashboard > Sessions** with the matching static claim:

```json
{ "aud": "fairway-api-staging" }
```

Enable the Clerk claim first, confirm a fresh token contains the expected `aud`,
and only then set `CLERK_AUDIENCE` on the API. The mobile app continues using its
existing `getToken()` call; no Clerk JWT template is needed. Use a distinct
audience value for each environment.

### Rate-limit operational alerts

The API aggregates limiter backend failures, overall denials, and repeated
denials from the same HMAC-derived abuse identifier. Threshold crossings emit a
critical structured log and are deduplicated with a cooldown. Set
`OPERATIONS_ALERT_WEBHOOK_URL` to an HTTPS endpoint to also receive a minimal
JSON alert containing the environment, event, policy, count, and bounded error
or hashed abuse metadata. Alerts never include bearer tokens, raw Clerk IDs,
raw IP addresses, request URLs, or request bodies.

The default thresholds are three backend failures, 50 denials for one policy,
or 10 denials for one hashed identity within five minutes, with a 15-minute
cooldown. Keep the webhook unset during local development unless you are testing
delivery to a controlled receiver. Per-process tracking is capped at 10,000
least-recently-used policy and identity keys so monitoring cannot grow memory
without bound under distributed abuse.

### Guarded AI planner

`POST /api/v1/me/plans/{plan_id}/ai-itinerary` can organize an existing
deterministic plan when `AI_PLANNER_ENABLED=true`. The server sends only the
persisted plan preferences and validated candidate facts to the configured
provider. Strict structured output and a second server-side validation pass
limit results to the supplied course IDs and requested dates; rationale and
caveats are rendered only from server-owned candidate facts. Provider errors,
timeouts, invalid output, the kill switch, and the monthly ceiling all return
the unchanged deterministic itinerary with `generation_status=fallback`.

The Gemini adapter uses `gemini-2.5-flash` with native structured JSON output.
Keep `GEMINI_API_KEY` only in the API secret store and use a paid-tier project
so submitted data is not used to improve Google's products. The default Redis
policy is a three-request burst, one token every two minutes, and 25 generations
per user per day; Redis failure is fail-closed for this cost-bearing route.
Configure the model's conservative per-million-token micro-dollar rates and
monthly cost ceiling alongside the model so persisted generation metadata can
stop new spend.
