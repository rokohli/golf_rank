# Supabase staging database

GolfRank continues to use Clerk for authentication and FastAPI as its only public data API. Supabase supplies managed PostgreSQL and, later, may supply object storage. The mobile app must never receive a database password or Supabase service-role key.

## Provision

1. Create a staging project in the same region as the staging API.
2. Store the generated database password in the deployment provider's secret manager.
3. Disable the Supabase Data API under **Project Settings → API**. GolfRank does not use PostgREST or GraphQL.
4. Keep Clerk Auth as the sole identity provider; do not enable a parallel Supabase Auth flow.
5. Use the direct database connection for Alembic and administrative commands. Use the direct connection for a persistent IPv6-capable API host, or Supavisor session mode for a persistent IPv4-only host.

## Runtime secrets

Configure these only on the staging API service:

```dotenv
APP_ENV=staging
ALLOW_DEVELOPMENT_IDENTITY=false
DATABASE_URL=postgresql+psycopg://postgres.<project-ref>:<password>@<host>:5432/postgres?sslmode=require
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=5
CLERK_ISSUER=<staging Clerk issuer>
CLERK_JWKS_URL=<staging Clerk JWKS URL>
CLERK_AUDIENCE=<expected audience when configured>
```

Do not add these values to `.env`, EAS public variables, GitHub Actions logs, or the repository.

## Migrate and seed

From `services/api`, using the direct connection:

```bash
DATABASE_URL='<direct-url>' alembic upgrade head
DATABASE_URL='<direct-url>' alembic current
DATABASE_URL='<direct-url>' python -m app.catalog_import --state CA --dry-run
DATABASE_URL='<direct-url>' python -m app.catalog_import --state CA
```

The expected migration head is `0011_seed_course_facts`. Confirm `/health` and `/ready` before pointing a preview build at the API.

## Verification

- Complete onboarding with a staging Clerk user.
- Search for a course inside and outside the selected region.
- Rate a course, edit its score, notes, and favorite hole, then log a separate round.
- Verify rankings, saved courses, friends activity, and profile summaries survive an API restart.
- Confirm a database connection failure makes `/ready` return `503` while `/health` remains a process-liveness check.

## Backups and promotion

Use a paid plan with managed daily backups before storing production data. Before production cutover, restore a backup into a separate project and repeat the verification flow. Database backups do not restore deleted Supabase Storage objects; establish a separate object retention and recovery policy before golfer photo uploads launch.
