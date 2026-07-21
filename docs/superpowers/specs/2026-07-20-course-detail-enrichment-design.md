# Course Detail Enrichment Design

**Date:** 2026-07-20

## Objective

Back the course-detail presentation with canonical API data for holes, par, slope, tee-time navigation, and attributed course imagery. Unknown provider data remains nullable and must never be invented by the client.

## Course facts

The canonical `courses` record adds nullable `par`, `slope_rating`, and `tee_time_url` fields. The existing OpenGolfAPI state import maps its documented top-level `par` value. Slope and tee-time links remain separately verified enrichment because the state-list payload does not provide them.

The three deterministic seed courses include verified holes, par, slope, and official booking-information links. Existing seed rows are enriched by the migration and by development seeding.

## Course imagery

Each ordered course image stores exactly one locator:

- `external_url` for an attributed, licensed remote image.
- `storage_key` for a GolfRank-managed object.

Image records also carry alt text, source name, source URL, position, and hero status. External images should not be added without confirming display rights and recording attribution.

The API resolves storage keys through the optional `COURSE_IMAGE_BASE_URL` environment setting. This keeps public object hosting provider-neutral: S3-compatible storage, Cloudflare R2, Supabase Storage, or another CDN can be selected without changing the database or mobile contract. Private buckets and signed uploads require a later authenticated upload design.

## Client behavior

- Use the first available hero image returned by the API; retain the bundled course artwork when none exists.
- Render ordered course images with accessible alt text and visible source attribution.
- Hide unavailable imagery behind an honest empty state.
- Continue using the official tee-time URL when present and a web search fallback otherwise.

## Deferred work

- Authenticated golfer photo uploads
- Image moderation and reporting
- Private-object signing and upload authorization
- Image transformation, resizing, and deletion lifecycle
