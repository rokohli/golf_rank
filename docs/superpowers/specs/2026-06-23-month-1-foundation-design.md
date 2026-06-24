# GolfRank AI Month 1 Foundation Design

## Goal

Deliver a locally runnable foundation for GolfRank AI: a mobile onboarding and course-discovery flow backed by a containerized FastAPI service, PostgreSQL, and Redis.

## Scope

This slice includes account identity boundaries, profiles and onboarding preferences, course search, deterministic development data, and test coverage for the API and mobile UI.

It excludes reviews, rankings, social feeds, AI agents, embeddings, uploads, notifications, production deployment, and external authentication setup.

## Repository Layout

```text
apps/frontend/       Expo Router mobile app
services/api/         FastAPI application, migrations, and API tests
packages/contracts/   Versioned HTTP contract documentation and shared fixtures
infra/                Docker Compose and local infrastructure configuration
docs/                 Architecture and implementation documents
```

The frontend calls the API over HTTP. It owns presentation, local form state, and request handling. The API owns authorization boundaries, validation, persistence, and query behavior. No Python or TypeScript runtime package is shared across these boundary lines.

## Mobile Application

`apps/frontend` uses Expo Router. It has two initial routes:

- An onboarding route that gathers home region, typical green-fee budget, preferred difficulty, and public/private-course preference.
- A course-discovery route that searches seeded courses by text and applies the same location, budget, difficulty, and access filters.

The user must receive an inline, actionable error when a request fails. Successful onboarding persists preferences through the API and navigates to discovery.

## API and Authentication Boundary

`services/api` uses FastAPI and exposes:

- `GET /health`
- `GET /api/v1/courses`
- `GET /api/v1/me/profile`
- `PUT /api/v1/me/onboarding-preferences`

All `/me` endpoints depend on a `CurrentUser` interface. Local development may resolve that interface only from a development identity header when `APP_ENV=development`; startup rejects that mode outside development. A future Clerk adapter verifies Clerk-issued JWTs and returns the same `CurrentUser`, without changing route handlers or business logic.

No authorization decision trusts a user ID from an API request body or query parameter.

## Data Model

PostgreSQL is the system of record. PostGIS supports future proximity search but the initial API uses bounded, indexed query filters.

- `users`: internal identity record keyed by a provider subject.
- `profiles`: one-to-one user profile including home region.
- `onboarding_preferences`: one-to-one preference record containing budget, difficulty, and course-access preference.
- `courses`: canonical course details, geographic point, public/private access, difficulty, and indicative price.

The schema includes unique constraints for one profile and one preference record per user; an upsert makes onboarding idempotent. Migrations create text, filter, and location indexes. Development seeds are deterministic and safe to rerun.

## Local Infrastructure

Docker Compose starts PostgreSQL with PostGIS, Redis, and the API. Redis is present for the planned job/cache layer but does not carry application state in this slice. A worker service is a documented placeholder rather than a fake queue implementation.

The frontend runs with Expo locally and reads its API base URL from an environment variable. Secrets are never committed; example environment files document required non-secret configuration.

## Error Handling and Observability

The API emits stable JSON error bodies for validation, authentication, authorization, and unexpected failures. Request IDs are accepted or generated and returned in response headers. Sensitive headers and preference values are not written to logs.

## Testing

API tests cover health, development-auth restrictions, profile isolation, onboarding upsert and validation, and course-search filters. Mobile tests cover required fields, successful onboarding submission, and visible request failures. CI setup is deferred until the foundation test commands are stable locally.

## Acceptance Criteria

1. `docker compose up` starts a healthy local database, cache, and API.
2. A local frontend user can submit onboarding preferences and search seeded courses.
3. Requests cannot read or update another user's profile or preferences.
4. Production-mode configuration cannot enable the local identity header.
5. API and mobile tests pass from a clean checkout after documented setup.
