# Mobile production cutover

This runbook separates build configuration from external production activation. The tracked Expo configuration is safe to merge before any production services exist. Do not submit a store build or point a public binary at production until every cutover check below has passed.

## Build profiles

Run EAS commands from `apps/frontend`:

- `development` is an internal development-client build using EAS's `development` environment.
- `development-simulator` is the same client for an iOS Simulator.
- `preview` is an internal, production-like build using the `preview` environment.
- `production` is the store build using the `production` environment. EAS maintains its build numbers and increments them for each production build.

The development profile requires `expo-dev-client`, which is a project dependency. The preview profile is deliberately a standalone app: it must work without a Metro server before it is shared with testers.

Before the first build, run `npx eas-cli@latest build:configure` from `apps/frontend` and link the resulting EAS project. Do not add the generated project ID, signing credentials, or service secrets manually from another environment.

## Mobile identity and public build variables

Choose the final iOS bundle identifier and Android package name in the Expo configuration, register them in Apple Developer and Google Play, then link the EAS project. These IDs are intentionally not guessed in source control.

Create these EAS environment variables for each named environment:

| EAS environment | `EXPO_PUBLIC_AUTH_MODE` | `EXPO_PUBLIC_API_URL` | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| --- | --- | --- | --- |
| development | `development` or `clerk` | local or development API URL | development Clerk key only when using Clerk |
| preview | `clerk` | staging API HTTPS URL | staging Clerk publishable key |
| production | `clerk` | production API HTTPS URL | production Clerk publishable key |

Values prefixed `EXPO_PUBLIC_` are embedded in the app. They may contain the API URL and Clerk *publishable* key, but never a Clerk secret key, database URL/password, Supabase service-role key, Redis URL, or provider API key.

## Provision production separately

1. For the controlled beta, create isolated beta Supabase, Render API, Redis/Key Value, and Clerk resources. Keep all staging resources and credentials unchanged. A future public launch needs a separately costed database and availability decision.
2. Configure the production API with `APP_ENV=production`, `ALLOW_DEVELOPMENT_IDENTITY=false`, its production database/Redis credentials, and a unique `CLERK_AUDIENCE` such as `fairway-api-production`.
3. Add the exact production `aud` claim to the production Clerk session token before requiring it at the API. Obtain a fresh token and test it with the production build.
4. Set a production-only host allowlist, HTTPS operations-alert receiver, and non-empty rate-limit key salt. Keep the provider AI planner disabled until its separate controlled rollout.
5. Run Alembic migrations against the production database with an administrative connection. Import only the intended launch catalog and verify attribution, search coverage, and rollback/restore procedures.
6. Take an initial encrypted logical dump, copy it to private R2, restore it into a separate project, and record the result. A database restore does not recover future object-storage photos.

## Observability and recovery decision

This is the selected production stack. Selection does not authorize an integration or a provider account change; those are separate implementation and operations tasks.

| Concern | Selected service | Initial policy | Deliberately deferred |
| --- | --- | --- | --- |
| Mobile and API errors | Sentry | One `golfrank` project receives React Native and FastAPI errors. Tag every event with `environment`, release, and `component` (`mobile` or `api`); send no tokens, emails, notes, location coordinates, request bodies, or raw Clerk subjects. | Tracing, session replay, profiling, and broad performance sampling remain off until a privacy review and cost budget exist. |
| Independent availability | Better Stack Uptime | Monitor public `/health` and `/ready` from outside Render every three minutes. Alert the release owner by email and mobile push on failure, with a 15-minute escalation to the backup owner. Add SSL-expiry monitoring once the production domain is live. | Public status page and paid/on-call escalation are deferred until the beta has an operating owner rotation. |
| Backup completion | Better Stack Heartbeats | The successful daily logical-backup task pings one heartbeat only after its encrypted R2 copy completes. A missed heartbeat alerts the release owner. | Heartbeats do not replace database backup verification or provider backups. |
| Beta database availability | Existing Supabase Free project | Use only for a controlled beta with an explicit owner. Better Stack monitors detect an unreachable API; the owner resumes a paused project if needed. | The Free plan has no automatic backups and can pause after seven days of low activity. It is not an acceptable public-launch availability guarantee. |
| Primary recovery source | Private Cloudflare R2 Standard bucket | Create one encrypted logical PostgreSQL dump per day, retain 35 days, and restore-test it weekly into an isolated project. Access is write-only for the backup job and read-only for named recovery operators. This gives the beta an RPO of 24 hours and a four-hour best-effort RTO. | R2 is not a database backup engine and must not be exposed publicly. Do not mix application photos with database backups. |

### Minimum implementation contract

When integration begins, use the following defaults:

1. Create distinct Sentry environments for `staging` and `production`; use the mobile app version plus Git SHA for releases. Send one labeled synthetic exception from each component and verify the issue, alert, source context, and resolution workflow.
2. Configure Better Stack monitors to expect `200` from both endpoints. `/health` proves process liveness; `/ready` proves the API can reach its dependencies. Keep monitor requests unauthenticated and do not add any custom header that grants access.
3. Run the existing logical-backup and restore-verification scripts with beta credentials only from a dedicated operator environment. Encrypt the generated dump before its R2 upload; retain no unencrypted copy after the verification window. Until a low-cost scheduler is selected, this is a named daily release-owner task, not an implied automated job.
4. Practice an actual recovery before inviting beta users: restore the latest R2 dump into a separate project, run migrations, verify key row counts and API readiness, then record elapsed time against the four-hour RTO.
5. Maintain a short incident runbook with the release owner, backup owner, service links, rollback method, and a decision rule for when to restore versus roll forward.

Supabase backups cover database contents, not objects deleted from Storage. If private photos launch later, add an independent object-retention and recovery policy before allowing uploads.

## Release gates

- A preview build has completed onboarding, course discovery, ratings, rounds, saves, rankings, social activity, and planner flows with a real staging Clerk account.
- The release owner has completed the daily encrypted R2 backup and the weekly restore drill. A public launch cannot proceed while the application is on a Supabase Free project; select a costed database/availability plan at that point.
- Production `/health` and `/ready` are healthy; missing, malformed, and wrong-audience tokens are rejected.
- Rate-limit alerts, uptime monitoring, backend error reporting, and mobile crash reporting have each delivered one controlled test event.
- `npm audit --omit=dev --audit-level=high` has no unreviewed high or critical findings. As of this initial EAS setup, the Expo 53 / React Native 0.79 dependency tree reports high findings without a non-breaking remediation; treat the required Expo SDK upgrade or an explicitly time-bounded risk acceptance as a separate release gate.
- Privacy Policy, Terms, account-deletion, data-export, support, and reporting paths are available in the release candidate.
- App Store Connect/TestFlight and Google Play internal testing have accepted the first store-signed production builds.
- A named release owner has approved the production configuration and rollback plan.

## First commands after external provisioning

```bash
cd apps/frontend
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile preview --platform all
npx eas-cli@latest build --profile production --platform all
```

Use `preview` for stakeholder testing. Use the production profile only after the release gates pass; build submission is a separate deliberate action.
