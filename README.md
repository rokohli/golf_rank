# GolfRank AI

## Local API


```bash
cd services/api
/opt/anaconda3/bin/python -m pip install -e '.[dev]'
/opt/anaconda3/bin/python -m pytest -v
```

The API defaults to SQLite for isolated local tests. Docker Compose runs the production-shaped path with PostgreSQL/PostGIS, Redis, Alembic migrations, and deterministic course seed data.

```bash
cp .env.example .env
docker compose up --build
curl http://localhost:8000/health
```

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

In this mode, the frontend sends:

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
