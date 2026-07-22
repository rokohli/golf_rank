# Supabase staging database

GolfRank continues to use Clerk for authentication and FastAPI as its only public data API. Supabase supplies managed PostgreSQL and, later, may supply object storage. The mobile app must never receive a database password or Supabase service-role key.

## Provision

1. Create a staging project in the same region as the staging API.
2. Store the generated database password in the deployment provider's secret manager.
3. Disable the Supabase Data API under **Project Settings → API** when the plan and dashboard expose that control. GolfRank does not use PostgREST or GraphQL. Migration `0012_data_api_hardening` also enables RLS and revokes Data API role grants as a database-level backstop.
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

The expected migration head is `0014_provider_first_catalog`. Confirm `/health` and `/ready` before pointing a preview build at the API.

## Verification

- Complete onboarding with a staging Clerk user.
- Search for a course inside and outside the selected region.
- Rate a course, edit its score, notes, and favorite hole, then log a separate round.
- Verify rankings, saved courses, friends activity, and profile summaries survive an API restart.
- Confirm a database connection failure makes `/ready` return `503` while `/health` remains a process-liveness check.

## Backups and promotion

The Free Plan does not include managed downloadable backups. Keep Free projects limited to reproducible staging data, and regularly create an off-platform logical dump with `supabase db dump` or `pg_dump` if staging begins collecting data that cannot be recreated.

For Fairway's backend-only access model, keep schema recovery in the source-controlled Alembic migrations and export application data with the restricted runtime connection:

```bash
cd services/api
DATABASE_URL='<session-pooler-runtime-url>' ./scripts/backup_staging_data.sh
./scripts/verify_staging_backup.sh ../../.backups/<backup-file>.dump
```

Backup files are stored under the ignored `.backups/` directory with owner-only permissions. Copy them to a separate encrypted location for actual disaster recovery; a file that exists only on the development machine is not an off-site backup. The verification script restores into a disposable PostgreSQL 17/PostGIS container that matches staging's database major version, runs every Alembic migration, loads the dump, checks key row counts, and removes the container.

Use a paid plan with managed daily backups before storing production data. Before production cutover, restore a backup into a separate project and repeat the verification flow. Database backups do not restore deleted Supabase Storage objects; establish a separate object retention and recovery policy before golfer photo uploads launch.
