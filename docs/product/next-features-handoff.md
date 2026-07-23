# Fairway next-features handoff

## Current baseline

Fairway has a real Clerk-authenticated mobile client, FastAPI backend, Render staging service, Supabase PostgreSQL database, course discovery, ratings, rankings, rounds, saved courses, profiles, following, and a social feed. CI covers frontend tests and types, backend tests, and the complete PostGIS migration cycle.

The next work should harden the real product flows before adding broad new surfaces. The deterministic planner and provider-first catalog are deployed, and production course presentation now uses only attributed API images or a neutral placeholder.

## Recommended implementation order

1. Finish API security operations, especially limiter and unusual-traffic alerting.
2. Add the AI planning layer with strict factual guardrails.
3. Add private round and course-memory photos.
4. Make Friends' thoughts real on course pages.
5. Implement actual notifications and availability signals.
6. Add EAS distribution, monitoring, and a separate production environment.

## 1. Canonical course identity and presentation

### Provider-first catalog completed

Migration `0014_provider_first_catalog` makes OpenGolfAPI identities authoritative for the three legacy fixture courses while preserving their stable database IDs, user relationships, and curated facts that OpenGolfAPI does not provide. The redundant provider rows and obsolete reconciliation mappings are removed. Deployed catalogs are populated only by the explicit OpenGolfAPI import job; the three deterministic seed rows remain SQLite-only test fixtures.

Production course surfaces no longer use bundled demo-course photographs. Discover, Saved, Feed, Profile, Planner, Rankings, course detail, and rating comparisons render an attributed `Course.images` photograph when available and the same neutral non-photographic placeholder otherwise. Legacy demo slugs are rejected instead of presenting invented course data.

### Scope

- Keep `course_reconciliations` for future cross-provider aliases that cannot be collapsed into one provider-owned row.
- Add an idempotent reconciliation command that proposes matches using normalized name, coordinates, city, hole count, and par, but requires an explicit mapping before merging ambiguous records.
- Make search, detail, planner candidates, and relationship writes resolve aliases to the canonical course ID.
- Keep image ingestion attribution-safe: every stored image needs its real course ID, source name, source URL, and display permission.

### Acceptance criteria

- Searching `Pebble` continues to return one Pebble Beach Golf Links result.
- Existing ratings, rounds, saves, and feed events continue to resolve to the same stable course ID.
- Re-running reconciliation is idempotent.
- No unrelated courses are automatically merged solely because their names are similar.
- Real courses never display another course's photograph.

## 2. Real trip planner, deterministic release completed

### Existing foundation

The backend supports authenticated create, update/regenerate, save, list, get, and delete operations under `/api/v1/me/plans`. It ranks candidates using destination-derived geography, dates, budget, personal rankings, saved courses, and played history. Plans, constraints, candidates, and itinerary items persist in PostgreSQL.

The mobile planner calls the persisted API, is linked from Home and Profile, accepts US-formatted dates, derives origin from destination/regions, and supports create, refine, save, reopen, and delete with real catalog courses.

### Completed mobile behavior

- API client methods and types cover create, update, save, list, get, and delete.
- Home and Profile link to Planner without replacing a core bottom-navigation tab.
- The plan form asks for destination/regions, dates, party size, maximum green fee, and must-haves; origin is resolved from the destination instead of exposed as coordinates.
- Users can refine the same persisted query after the initial result.
- Candidates, reasons, caveats, distances, and itinerary items come from the API.
- My trips supports draft/saved states, reopen, edit, and delete.
- Loading, empty, validation, error, and retry states are explicit.

### Backend refinements

- Treat unknown green fees explicitly instead of implying that an unknown price fits the budget.
- Keep tee-time availability unverified unless a current source confirms it.
- Include each candidate's `tee_time_url` when known.
- Ensure all planner reads and writes remain owner-scoped.

### Acceptance criteria

- A signed-in user can create, regenerate, save, reopen, and delete a real plan.
- Closing and reopening the app preserves saved trips.
- Every course in a plan exists in the canonical catalog.
- Another user receives `404` for the plan.
- No restaurant, lodging, price, tee time, or travel duration is invented.

## 3. API security and abuse prevention

### Current baseline

- Clerk bearer authentication protects personal, social, rating, round, save, and planner operations.
- Staging disables the development identity bypass, and API queries generally scope private records to the authenticated application user.
- Supabase application tables have RLS enabled, direct Data API privileges are revoked, and Render uses the restricted `fairway_api` runtime role instead of an administrative database login.
- Pydantic input constraints and pagination caps limit many individual payload and response sizes.
- Render terminates HTTPS, secrets remain in provider secret stores, and the Expo client receives no database or Supabase service-role credential.
- Redis-backed token buckets protect public catalog reads, authenticated reads and writes, readiness checks, and course-candidate submissions. Candidate submissions also have a per-user daily quota.
- The private Oregon Render Key Value service is deployed and connected through its internal URL. Staging verification covers shared bucket behavior, spoofed forwarding headers, `429` and `Retry-After`, recovery, and the `/ready` deployment gate.
- Non-development deployments disable interactive API docs, validate hosts, reject oversized request bodies, return security headers, and never reflect malformed request IDs.
- `/health` remains database-free and exempt from user limits; `/ready` is independently rate-limited and caches its database result briefly.
- Cross-user authorization regression coverage protects profiles, rankings, plans and their generated children, saved lists and nested courses, rounds and nested private details, per-user rating details, social relationships, feed visibility, and reactions.
- Pull-request CI audits frontend and production Python dependencies, runs Python static analysis, and scans the complete Git history for secrets. GitHub Actions are pinned to immutable commits, and Dependabot checks npm, pip, and Actions weekly.

The application-level limiter foundation is implemented, covered against a real Redis service in CI, and deployed to staging with a private Render Key Value service. The Clerk session-token audience is also enforced in staging. Privacy-safe alert aggregation and optional webhook delivery are implemented locally; publishing the worktree and configuring an HTTPS alert receiver remain before delivery can be verified in staging. Security still depends heavily on consistent FastAPI ownership checks because the shared runtime database role can access application records.

### Redis and Lua token-bucket limiter, implemented

- Use the existing local Redis service and add a private Render Key Value instance named for Fairway rate limits in the same Oregon region as the API.
- Connect Render through the internal `REDIS_URL`; do not enable public access. Internal authentication should be enabled before production.
- Persistence can remain off because limiter state is temporary and safe to lose during a restart.
- Add the async `redis` Python client, typed rate-limit settings, connection lifecycle management, and health metrics without logging credentials.
- Implement a token bucket as one atomic Lua operation. Store only remaining tokens and the last refill timestamp, set an expiry on inactive buckets, and never store tokens, email addresses, request bodies, notes, or other personal data in limiter keys.
- Key authenticated buckets by the stable Clerk subject and public buckets by Cloudflare's single-value `CF-Connecting-IP` header on Render, with strict IP validation and direct-socket fallback. Never key limits from the caller-controlled `X-Forwarded-For` chain.
- Support weighted request costs so expensive operations consume more tokens than ordinary reads.
- Add a separate atomic fixed-period counter for hard quotas such as maximum AI generations or uploads per day. Token buckets control bursts; quota counters control total cost.

### Initial policies

| Operation | Key | Token-bucket policy | Hard quota |
| --- | --- | --- | --- |
| Public course search and regions | Client IP | Capacity 60, refill 1/second | None initially |
| Authenticated reads | Clerk subject | Capacity 120, refill 2/second | None initially |
| Ratings, rounds, saves, and social writes | Clerk subject | Capacity 20, refill 1 every 3 seconds | None initially |
| Course candidate submissions | Clerk subject and IP | Capacity 2, refill 1/hour | 5/day per user |
| Future private photo uploads | Clerk subject and IP | Capacity 5, refill 1 every 6 minutes | 20/day per user |
| Future AI plan generation | Clerk subject and IP | Capacity 3, refill 1 every 2 minutes | 25/day per user |

Treat these as environment-backed defaults that can be tuned without changing endpoint code. Exempt Render's lightweight liveness probe from user limits, and protect database-backed readiness checks separately so health monitoring cannot become a database-load vector.

### Response and failure behavior

- Reject exhausted buckets with `429 Too Many Requests` and include `Retry-After`, limit, remaining-capacity, and reset information.
- Return the same generic response shape regardless of whether an account exists; rate limiting must not become an account-enumeration channel.
- Fail open for ordinary catalog reads and low-cost authenticated operations when Redis is temporarily unavailable, while emitting a structured error and metric.
- Fail closed with `503 Service Unavailable` for AI generation, uploads, and other directly cost-bearing operations if their limiter cannot be checked.
- Add alerts for sustained limiter failures, unusual `429` volume, and repeated abuse from one user or address. Logs must use hashed or truncated abuse identifiers and must not include bearer tokens or private content.

#### Rate-limit operational alerting, implementation ready

- Aggregate limiter-backend failures, per-policy denials, and repeated denials from the same HMAC-derived abuse identifier over a configurable five-minute window.
- Emit a critical structured log after three backend failures, 50 denials for one policy, or 10 denials for one hashed identity. Deduplicate matching alerts for 15 minutes.
- Optionally send the same minimal event to `OPERATIONS_ALERT_WEBHOOK_URL`. Require HTTPS outside development and never include tokens, raw Clerk subjects, raw IP addresses, request URLs, request bodies, or Redis connection details.
- Bound in-process tracking to 10,000 least-recently-used keys. The current single-instance staging topology can use this directly; if the API scales horizontally, move aggregation into shared infrastructure or the downstream log provider.
- Before marking delivery complete, publish and deploy the implementation, configure a controlled HTTPS receiver or log-stream alert rule, trigger one synthetic threshold crossing, and verify receipt without using a real user's identity or traffic.

### Authentication and API hardening

- Continue verifying Clerk token signature, issuer, expiry, subject, and intended audience. Keep the development identity path impossible to enable in staging or production.

#### Clerk session-token audience rollout, implemented

Purpose: bind a valid Clerk token to the Fairway API as its intended recipient. Signature and issuer checks prove that Clerk issued a token for a user; the `aud` check additionally prevents a valid token intended for a different service from being accepted by this API.

Decision: customize Clerk's normal session token with a small static `aud` claim instead of creating a separate JWT template. The mobile client should continue using its existing `getToken()` call. A custom JWT template would add a token-generation network request and would omit session-bound claims such as `sid`; neither tradeoff is needed solely to add audience binding. Clerk's default session-token claims do not include `aud`, but Clerk supports adding custom claims to the session token.

Use one stable, environment-specific value. For staging, use `fairway-api-staging` consistently in Clerk and Render; reserve a different value such as `fairway-api-production` for the future production environment.

Completed staging rollout:

1. In the staging Clerk Dashboard, open Sessions and add `"aud": "fairway-api-staging"` to the customized session-token claims. Do not add email, profile metadata, or other unnecessary claims.
2. With a real staging user, obtain a fresh token through the existing Expo `getToken()` path and confirm only that its decoded `aud` equals `fairway-api-staging`; never log or commit the token itself.
3. Add backend tests proving the configured audience accepts the expected value and rejects missing, malformed, and different `aud` values with the same generic `401` response.
4. Set Render `CLERK_AUDIENCE=fairway-api-staging` and redeploy only after the Clerk claim is live. The backend already enables JWT audience verification when this setting is present.
5. Sign out and back in or otherwise force a fresh mobile token, then verify authenticated profile, planner, rating, round, save, and social requests against staging.
6. Update `.env.example` and `README.md` to describe the session-token claim rather than a JWT template.

On July 23, 2026, a fresh token from the Clerk development instance was verified to contain `aud=fairway-api-staging` without logging or storing the token. Render service `fairway-api` was then configured with the matching `CLERK_AUDIENCE`, deployed successfully as `dep-d9gs6mbeo5us73cnk9tg`, and verified live. `/health` and `/ready` returned `200`; authenticated planner, saved-list, round, ranking, and feed reads succeeded; and missing or malformed credentials returned generic `401` responses. The authenticated profile read returned its expected domain `404` for the verification user, demonstrating that audience authentication passed before profile lookup.

Rollout safety: enable the Clerk claim before requiring it in Render so existing clients do not enter a `401` outage. If rollback is necessary, remove `CLERK_AUDIENCE` from Render first; removing the extra Clerk claim can happen afterward. Do not reuse the staging audience in production.

References: [Clerk custom session tokens](https://clerk.com/docs/guides/sessions/customize-session-tokens), [Clerk default session-token claims](https://clerk.com/docs/guides/sessions/session-tokens), and [Clerk JWT templates](https://clerk.com/docs/guides/sessions/jwt-templates).

#### Cross-user authorization audit, implemented

- Non-owner plan reads, regeneration, save, and delete return `404`; list results expose only the caller's plans, candidates, and itinerary.
- Non-owner saved-list update, delete, course add, and course removal return `404`; another user's list contents and private notes remain absent from list results.
- Non-owner round read, update, and delete return `404`; round lists, summaries, course state, notes, and companions remain scoped to the caller.
- Rating state and rating-detail mutation remain per-user, while profile and ranking projections expose only the caller unless the explicit mutual-friend ranking policy applies.
- Follow, mute, and block removals affect only relationships owned by the caller. Feed tests cover public, mutual-friend, private, blocked, and muted visibility, and invisible events cannot be reacted to even when their IDs are known.
- Keep this matrix current for every new private resource, especially future photo metadata and objects. Prefer `404` for owner-scoped identifiers so response differences do not reveal whether another user's resource exists.

- Disable `/docs`, `/redoc`, and `/openapi.json` outside development unless an authenticated operational need is established.
- Keep `/health` lightweight and database-free. Cache or tightly protect `/ready` so repeated anonymous requests do not execute an unlimited number of database queries.
- Add trusted-host validation, explicit proxy trust configuration, request-body size limits, database and outbound-request timeouts, and conservative server timeouts.
- Add security headers including HSTS, `X-Content-Type-Options`, a restrictive referrer policy, and an appropriate content security policy for any browser-served surface.
- Define an explicit CORS allowlist if a browser client is introduced. Do not treat CORS as authorization, and do not use a wildcard with credentials.
- Keep request IDs, but generate a safe server request ID when a supplied value is missing or malformed rather than reflecting arbitrary header content.

### Supabase and secret boundaries

- Preserve RLS on every table in an exposed schema and preserve the revoked `anon`, `authenticated`, and `service_role` Data API grants unless a deliberately reviewed direct-client use case is added.
- Keep FastAPI as the only public data path. Never put the Supabase service-role key, `fairway_api` password, Render secret values, or Clerk secret keys in Expo variables, logs, tests, fixtures, or committed files.
- Keep the `fairway_api` role non-superuser, without RLS bypass, schema creation, role creation, database creation, or migration privileges. Administrative migrations must continue to use a separate privileged connection.
- Give each new table the minimum runtime grants and explicit RLS policy needed by the API role. Review both `SELECT` and mutation behavior because PostgreSQL updates also require row visibility.
- Use `security_invoker = true` for any view that must remain in an exposed schema, or place/revoke it outside the exposed Data API surface. Do not add security-definer functions to exposed schemas.
- For future Storage uploads, use private buckets and short-lived server-authorized operations. Enforce object ownership, MIME and size allowlists, randomized keys, count quotas, and explicit delete/retention behavior.
- Rotate credentials immediately if they are printed, committed, or otherwise exposed, then verify the old credential no longer works.

### CI and operational verification

#### Security automation, implemented

- `npm audit --audit-level=high` blocks high and critical frontend advisories. The non-breaking audit fix removed the current high and critical findings; remaining moderate `postcss` and `uuid` advisory paths require a breaking Expo upgrade and are tracked rather than force-upgraded.
- `pip-audit` resolves and checks the backend project's production dependency set separately from CI tooling, and Bandit blocks medium-or-higher findings in `services/api/app`.
- Gitleaks scans complete repository history. Its only allowlist is restricted to UUID-shaped OpenGolfAPI record identifiers in two reconciliation test files under the `generic-api-key` rule.
- All third-party Actions use reviewed immutable commit SHAs. Dependabot checks npm, pip, and GitHub Actions weekly with bounded pull-request volume.

- Maintain the implemented tests for token-bucket refill, burst capacity, weighted cost, daily quotas, separate user/IP buckets, reset behavior, `Retry-After`, spoofed proxy headers, Redis failure modes, and concurrency atomicity.
- Test that public routes have intended limits, private routes reject missing/invalid Clerk tokens, and health checks remain available under normal limiter load.
- Run a database privilege and RLS audit after every schema change and before production launch.
- Verify the deployed headers, authentication failures, rate-limit behavior, Render-to-Key-Value private connection, and alert delivery in staging before merging production configuration.

### Acceptance criteria

- The request after an exhausted bucket receives `429` with a correct retry duration, while another user retains an independent allowance.
- Concurrent requests cannot exceed the configured burst because the decision and update are atomic in Redis/Lua.
- Spoofing forwarding headers does not create a fresh client identity or bypass an IP limit.
- A Redis outage does not take down ordinary reads, but it cannot permit unmetered AI or upload spend.
- When `CLERK_AUDIENCE` is configured, only a fresh Clerk session token with the expected environment-specific `aud` is accepted; missing or different audiences receive the same generic `401` response.
- Every private resource has a cross-user denial test, and direct Supabase Data API roles cannot read application tables.
- Production secrets and database credentials remain absent from the mobile bundle, repository, logs, and limiter storage.

## 4. AI planner layer

### Product rule

The deterministic planner remains the authority for hard constraints and allowed courses. AI may organize and explain validated candidates; it must not create courses, claim live availability, or invent prices.

### Architecture

- Add a provider-neutral `PlannerNarrativeProvider` interface in FastAPI.
- Pass only minimized planning preferences and the server-selected candidate set to the provider. Do not send email addresses, Clerk identifiers, private notes, or friend data.
- Require structured output containing:
  - a concise trip summary;
  - an ordered list of allowed `course_id` values;
  - itinerary entries bounded by the requested dates;
  - rationale tied to known ranking, save, distance, and budget signals;
  - explicit caveats for unknown price or availability.
- Validate the response server-side. Reject unknown IDs, out-of-range dates, unsupported claims, and violations of hard constraints.
- Fall back to the deterministic itinerary on timeout, provider error, invalid output, or disabled AI configuration.
- Persist generation metadata in a new `plan_generations` table: plan ID, status, provider, model identifier, prompt version, latency, token usage, fallback reason, and timestamps. Do not persist raw secrets or an unnecessary full prompt transcript.
- Add per-user rate limits, request timeouts, a monthly cost ceiling, and kill-switch configuration.

### Suggested API

- `POST /api/v1/me/plans/{plan_id}/ai-itinerary`
- Return the updated `PlanOut` plus `generation_status` and `generated_summary`.
- A repeated request regenerates from the same persisted constraints and current canonical candidates.

### Acceptance criteria

- AI output references only candidate IDs supplied by the backend.
- Disabling or failing the provider still returns a useful deterministic plan.
- Unknown tee-time availability and prices remain visibly unverified.
- Provider credentials exist only in Render secrets.
- Tests cover invalid model output, timeout, rate limiting, fallback, and user isolation.

## 5. Private golf-memory photos

### Problem

`expo-image-picker` is installed, but Add photos is intentionally disabled in rating and course-detail flows. Database backups also do not restore deleted Storage objects, so object recovery must be designed before launch.

### Scope

- Create a private Supabase Storage bucket for user golf memories.
- Keep Clerk as the identity provider; the mobile app must not receive a Supabase service-role key.
- Have FastAPI issue short-lived signed upload and read URLs after Clerk authorization.
- Add `round_photos` with owner, round, course, object key, MIME type, byte size, caption, position, and timestamps.
- Support image selection, compression, upload progress, retry, reorder, caption edit, and delete.
- Enforce MIME allowlists, size/count quotas, randomized object keys, and ownership checks.
- Start with private photos. Public or friends-visible photos require a separate moderation and reporting design.
- Add a separate object-backup or retention process; database dumps preserve metadata only.

### Acceptance criteria

- A user can add and remove photos from their own round.
- Another user cannot read or mutate private photo metadata or objects.
- Failed uploads leave no completed database record or abandoned permanent object.
- Deleting a round follows an explicit object-retention policy.

## 6. Friends' thoughts on course pages

### Problem

The course-detail disclosure exists but always says Friends' thoughts are unavailable.

### Scope

- Add `GET /api/v1/courses/{course_id}/friends-thoughts`.
- Return only visible friend ratings and deliberately shared notes or favorite holes.
- Apply mutual-friend/follow rules consistently with Friends rankings, plus block and mute filtering.
- Never expose private round notes through this endpoint.
- Show aggregate friend rating, count, recent entries, empty state, and links to the friend's visible activity.
- Correct feed routing so round activity can open the round rather than always opening the course.

### Acceptance criteria

- Private details remain private.
- Blocking removes the relationship from both the endpoint and UI.
- Empty, loading, and error states are explicit.
- Tests cover friendship, visibility, block, mute, and ownership cases.

## 7. Notifications and availability

### Problem

The app persists one notification preference, but it does not register device tokens or send notifications. Onboarding currently promises nearby-friend, bucket-list availability, and AI trip notifications that do not exist.

### Scope

- Register and revoke Expo push tokens per installation.
- Split notification preferences by category.
- Start with events Fairway owns: follow activity, reactions, shared rounds, and completed AI plans.
- Add idempotent delivery records, retries, expiry handling, and token invalidation.
- Treat tee-time availability as a separate integration. Until a licensed/current provider exists, use official tee-time deep links and never claim availability.
- Add quiet hours and a user-visible notification inbox only after push delivery is reliable.

### Acceptance criteria

- Turning notifications off prevents new sends.
- Duplicate jobs do not produce duplicate pushes.
- Invalid tokens are disabled safely.
- Notification payloads contain no private notes or sensitive profile data.

## 8. Distribution and operational readiness

- Add EAS project configuration with development, staging preview, and production profiles.
- Keep staging pointed at the current Render/Supabase/Clerk staging environment.
- Create separate production Render, Supabase, and Clerk resources before inviting real users.
- Add backend error reporting, structured request IDs, uptime checks on `/ready`, and alerts for deployment or database failures.
- Add mobile crash reporting and a minimal privacy-aware analytics plan for onboarding completion, search success, first rating, first round, first friend, saved trip, and planner fallback rate.
- Move production to managed daily backups and perform a cloud restore drill before launch.

## Definition of done for every feature

- No demo-only content is presented as real user or course data.
- Authorization and privacy have backend tests, not only UI guards.
- New schema changes pass upgrade, downgrade, and re-upgrade against PostGIS.
- Frontend has loading, empty, error, saved, and retry states where relevant.
- Frontend tests and TypeScript, backend tests, migration CI, and `git diff --check` pass.
- Staging is verified with a real Clerk session after Render deploys.
- Secrets remain in provider secret stores; no service-role or database credential reaches Expo.
