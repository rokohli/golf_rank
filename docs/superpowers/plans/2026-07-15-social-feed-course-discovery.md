# Social Feed and Course Discovery Implementation Plan

## Current state

- The social backend is functional: authenticated user search, follow/unfollow, follow listing, and a visibility-aware activity feed exist in `services/api/app/social.py`. Round, ranking, and saved-course writes create activity events. Focused backend tests pass.
- The product is not socially functional end to end. `home.tsx` and `friends.tsx` render demo data, the frontend client has no feed/search/follow methods, and the Home heart, See all, friend search, add-friend, and friend tabs do not perform real actions.
- Course discovery is only partially functional. The API supports name, exact-region, fee, difficulty, and access filters, but startup seeds only three courses. Discover loads profile-filtered results once, silently falls back to demo data, and its filter icon has no action.

## Recommended catalog strategy

Use a GolfRank-owned canonical course catalog populated from a provider whose license explicitly permits persistent storage and public display. Do not use Google Places as the seed database.

Google Places now supports `golf_course` filtering in Nearby/Text Search, so it is useful for live “find a missing course” lookup and identity matching. However, Google prohibits prefetching, caching, or storing most Places content; only place IDs are broadly exempt. That makes Places a poor source for a durable `courses` table. It also requires attribution and pay-as-you-go field-mask discipline.

Recommended source order:

1. For a production catalog, license a golf-specific bulk provider that permits app display and local persistence. Evaluate GolfAPI/Golf Course Database with a small coverage and duplicate-quality bakeoff before signing.
2. For an inexpensive MVP, import an OpenStreetMap regional extract using `leisure=golf_course`, with required ODbL attribution and a deliberate review of share-alike obligations. Use a managed OSM data provider or bulk extracts, not systematic calls to public Nominatim/Overpass services.
3. Use Google Places only as an ephemeral missing-course search and reconciliation layer. Store the Google place ID plus GolfRank/user-supplied canonical data only when the applicable terms permit it.

Provider references:

- Google place types and `golf_course`: https://developers.google.com/maps/documentation/places/web-service/place-types
- Google Places storage/attribution policy: https://developers.google.com/maps/documentation/places/web-service/policies
- OpenStreetMap golf-course tagging: https://wiki.openstreetmap.org/wiki/Golf_course
- OpenStreetMap ODbL terms: https://www.openstreetmap.org/copyright/en-US
- GolfAPI catalog claim: https://golfapi.io/

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
6. Default to the user's onboarding home region but allow “All regions.” Persist the last explicit selection locally.
7. Add API tests for combined region/search filters, pagination, null commercial data, and stable ordering; add frontend tests for applying/clearing filters and honest failure states.

## Rollout and observability

- Track search queries with zero results, missing-course submissions, filter usage, provider freshness, import insert/update/retire counts, and duplicate-review backlog.
- Put provider lookup behind a server-side adapter and feature flag; never expose provider keys in Expo.
- Add a user “Can’t find a course?” flow that records a candidate for review. This closes real coverage gaps without making third-party lookup results canonical automatically.
- Before production import, obtain written confirmation that the selected provider license permits persistent storage, public display, derived fields, and use in rankings/recommendations.
