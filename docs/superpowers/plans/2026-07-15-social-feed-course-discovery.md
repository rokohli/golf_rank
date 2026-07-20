# Social Feed and Course Discovery Implementation Plan

## Implementation status (2026-07-15)

Implemented on `agent/discover-current-location`: real cursor-paginated feed, follows and mutual-Friends copy, search/follow/unfollow, reactions, mute/block safety, rating/re-rating events without refinement events, normalized canonical course schema, idempotent OpenGolfAPI California import, region/count and missing-course APIs, and region/distance/access/fee/difficulty Discover filters with current-location default and honest states. Comments remain intentionally excluded pending moderation/report requirements, as specified below.

## Current state

- The social experience is functional end to end: Home renders the authenticated, cursor-paginated feed; Following supports search, follow/unfollow, mutual-Friends state, block, and mute; reactions are persisted idempotently; and visibility is enforced by the API.
- Course-page ratings and re-ratings create feed activity. Refinement comparisons only update rankings and do not create social activity.
- Discover uses the canonical API catalog with current-location search, changeable region, distance/access/fee/difficulty filters, pagination, explicit loading/error/empty states, and missing-course submissions. It never silently substitutes demo catalog data.
- Catalog expansion now follows the states requested in users' onboarding regions. California was the first imported state; the explicit importer can derive additional states from saved profiles or accept repeated `--state` flags.

## Recommended catalog strategy

Use the GolfRank-owned canonical catalog populated from OpenGolfAPI's ODbL-licensed dataset. Keep the provider identity on every record, display attribution in Discover and feed surfaces, and retain the reconciliation layer so a different source can be added later without changing ranking IDs. Do not use Google Places as the seed database.

Google Places now supports `golf_course` filtering in Nearby/Text Search, so it is useful for live “find a missing course” lookup and identity matching. However, Google prohibits prefetching, caching, or storing most Places content; only place IDs are broadly exempt. That makes Places a poor source for a durable `courses` table. It also requires attribution and pay-as-you-go field-mask discipline.

Implemented source strategy:

1. Import OpenGolfAPI by state through the explicit idempotent CLI. Use `--onboarding-regions` to expand according to user demand while checking completeness and duplicate quality state by state.
2. Treat incomplete commercial metadata as nullable and reject malformed identity/location records with an auditable import summary.
3. Use user-submitted missing-course candidates for coverage gaps. Google Places can later be an ephemeral lookup/reconciliation aid, but not the durable source catalog; store only fields its applicable terms permit.

Provider references:

- OpenGolfAPI catalog and API documentation: https://opengolfapi.org/
- OpenGolfAPI dataset terms (ODbL): https://courses.opengolfapi.org/legal/terms
- Google place types and `golf_course`: https://developers.google.com/maps/documentation/places/web-service/place-types
- Google Places storage/attribution policy: https://developers.google.com/maps/documentation/places/web-service/policies

## Phase 1: Real read-only social feed

1. Add frontend `Activity`, `UserSummary`, and `Follow` types.
2. Add `getFeed`, `searchUsers`, `followUser`, `unfollowUser`, and follow-list calls to `src/api/client.ts` with client tests.
3. Replace demo activity in `home.tsx` with authenticated `GET /api/v1/feed` data, honest loading/error/empty states, pull-to-refresh, and navigation by event subject/course.
4. Replace demo rows in `friends.tsx` with real Following data. Wire search and add-friend to user search and follow endpoints. Hide Followers and Requests until their backend semantics exist rather than showing fake tabs.
5. Map the current event types (`round_logged`, `ranking_updated`, `course_saved`) to dedicated presentation components with an unknown-event fallback.
6. Add screen tests for successful, empty, error, refresh, and privacy-safe rendering.

Exit criteria: a newly logged friends-visible round appears for a mutual follower after refresh; private rounds never appear; no demo people or activities are shown when API calls fail.

## Phase 2: Social interactions and pagination

1. Decide whether “follow” or “friend” is the product model. The backend currently treats mutual follows as friends; make that explicit in UI copy or introduce friend requests.
2. Add cursor pagination to `/api/v1/feed` using `(created_at, id)` rather than offset pagination.
3. Add `activity_reactions` with a unique `(event_id, user_id, reaction)` constraint, reaction counts in feed responses, and idempotent PUT/DELETE endpoints. Only then activate the Home heart.
4. Add comments only after moderation/report/block requirements are defined. Do not ship comments as an unmoderated first step.
5. Add block/mute controls and ensure feed/search queries exclude blocked relationships in both directions.

## Phase 3: Canonical course catalog

1. Extend `courses` with stable source identity and normalized geography:
   - `source`, `source_course_id`, `google_place_id`
   - `country_code`, `admin1_code`, `admin1_name`, `city`
   - `facility_name`, `course_name`, `status`, `hole_count`
   - nullable `green_fee`, `access`, and `difficulty` because provider coverage will be incomplete
   - `source_updated_at`, `last_verified_at`
2. Add unique constraints on `(source, source_course_id)` and a dedupe/reconciliation table. Never dedupe on name alone; use normalized name, coordinates, city, and manual review for ambiguous facilities with multiple courses.
3. Replace import-on-app-start with an idempotent CLI/import job. The job should stage, validate, upsert, soft-retire missing records, produce counts/errors, and support dry runs.
4. Import one launch region first (California), measure coverage against a hand-checked fixture, then expand by state/country.
5. Preserve the three current seed rows as deterministic test fixtures only, not the production catalog mechanism.

## Phase 4: Region-aware discovery

1. Add `GET /api/v1/course-regions` returning normalized countries/admin areas/cities with course counts.
2. Change course search to accept `country`, `admin1`, `city`, `lat`, `lng`, `radius_miles`, and `cursor`. Keep `q`, access, fee, and difficulty combinable.
3. Search names and normalized geography, not just `Course.name`; replace exact free-form `region` matching.
4. Wire the Discover sliders button to a filter sheet with Region, distance, access, fee, and difficulty. Show active-filter chips and a clear-all action.
5. Remove the silent demo fallback. Loading, empty catalog, zero matches, and API failure need distinct states.
6. Default to current location after the user activates search, fall back to all California when location is unavailable, allow a changeable region, and persist the last explicit selection locally.
7. Add API tests for combined region/search filters, pagination, null commercial data, and stable ordering; add frontend tests for applying/clearing filters and honest failure states.

## Rollout and observability

- Track search queries with zero results, missing-course submissions, filter usage, provider freshness, import insert/update/retire counts, and duplicate-review backlog.
- Put provider lookup behind a server-side adapter and feature flag; never expose provider keys in Expo.
- Add a user “Can’t find a course?” flow that records a candidate for review. This closes real coverage gaps without making third-party lookup results canonical automatically.
- Before production import, obtain written confirmation that the selected provider license permits persistent storage, public display, derived fields, and use in rankings/recommendations.
