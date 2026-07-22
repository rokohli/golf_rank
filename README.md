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
ALLOW_DEVELOPMENT_IDENTITY=false
```

`CLERK_AUDIENCE` is supported when a Clerk JWT template supplies an `aud` claim.
The default Clerk mobile session token does not include that claim, so configure
the template and update the mobile `getToken()` call before making audience
validation mandatory.
