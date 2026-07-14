# Rating Experience Design

**Date:** 2026-07-14

## Objective

Make ratings a distinctive, comparison-driven part of GolfRank. All community and personal course ratings use an explicit ten-point scale. Users do not enter a numeric rating directly; the app derives their rating from golf-themed tier placement and a focused head-to-head comparison.

## Product principles

- Display every community and personal rating as `x.x / 10`.
- Do not use five-star rating rows, five-point values, or star icons as rating controls.
- Keep community consensus separate from the user's personal rating.
- Treat a completed rating as proof that the user played the course. Do not expose a separate Played action or badge.
- Keep the experience focused, simple, and clean, with one primary question per screen and no visible step counter.
- Keep notes, photos, favorite hole, and playing companions private unless the user explicitly shares them with friends.

## Rating language and bands

The existing internal ranking bands receive golf-themed names:

| Tier | Rating band | Supporting description |
| --- | --- | --- |
| Green | 8.5-10.0 | A personal favorite |
| Fairway | 7.0-8.4 | A course worth returning to |
| Rough | 5.0-6.9 | An uneven or average experience |
| Bunker | 1.0-4.9 | Not for me |

The supporting descriptions may appear in the rating flow to make the choices clear. The course page shows only the user's numeric rating, not the tier or its description.

## Primary experience

### First rating

Pressing **Rate** on an unrated course opens a full-screen guided experience:

1. The user places the course in Green, Fairway, Rough, or Bunker.
2. The user may add a golf score. The play date defaults to today and remains editable. The score is optional, but the dated round is created because rating the course means it was played.
3. When a suitable course already exists in the selected tier, the user completes one head-to-head comparison. The choices include either course, Too close, and Not sure.
4. The app saves the tier placement and comparison, derives the personal `/10` rating, and reveals the result.
5. The user may add private round details: notes, favorite hole, photos, and playing companions.
6. The user may explicitly choose to share the rating activity and selected details with friends.

If no suitable comparison course exists, the flow skips the comparison and derives the rating from the tier placement alone. Optional inputs always have a clear Skip action.

The final result feels earned rather than typed. A concise reveal such as **Pebble Beach is now 9.3 / 10** closes the core rating flow.

### Existing rating

After the server confirms a rating, the course action becomes **check-circle Rated**. Pressing it again opens the saved rating and round details.

- Details can be edited without recalculating the rating.
- The current tier is preselected.
- Changing the tier requires a new comparison when a suitable peer exists, then recalculates the rating.
- An unchanged tier does not force another comparison. A separate Refine rating action may start an additional comparison.

The client must not show Rated until the server confirms the save.

## Round details and companions

The rating creates or updates a dated round. Its golf score is nullable. Notes and favorite hole belong to that round rather than to the course-level rating.

The companion picker searches existing GolfRank friends. A small **Add guest** action opens the device contact picker. When a contact is selected:

1. Show the selected name and proposed invitation text.
2. Require an explicit **Send invite** confirmation.
3. Open the system SMS composer with an editable message.
4. Never send an SMS silently or automatically.
5. Do not persist the guest's phone number. A guest display name may be retained with the round.

An SMS cancellation or failure does not undo a saved rating or round.

## Photo scope

Photo controls are visible in the first implementation to establish the intended experience, but uploads and persistence are out of scope. The UI must clearly communicate that photo support is coming; it must not imply that an unpersisted photo was saved.

## Course presentation

Community and personal ratings remain distinct:

```text
Community rating     8.8 / 10 · 392 ratings
Your rating          9.3 / 10
```

Courses without a community aggregate show **No ratings yet**. The UI must not invent a default value.

The simplified course action row contains:

- Rate or check-circle Rated
- Save
- Share

The Played and Review actions are removed. Played is implied by a rating, while notes and optional sharing live in the rating experience.

The golf difficulty value such as `72.4` is labeled **Course rating** so it cannot be confused with the community `/10` score.

## Ten-point consistency

Replace five-star presentation and `4.x` five-point demo ratings across:

- Course detail
- Home recommendations
- Discover cards, featured courses, nearby courses, and search results
- Shared course-card and course-row components
- Signed-out welcome artwork
- Profile rating summaries

The rankings screen already uses `/10` and retains that format. Decorative icons that do not communicate a rating scale may remain, but rating displays and controls must not use stars.

## Data model

The current tier assignments, comparisons, confidence data, and immutable ranking snapshots remain the authoritative rating engine.

Add a current per-user, per-course rating projection with a unique `(user_id, course_id)` key. It stores at least:

- Current tier
- Current derived numeric rating
- Current confidence
- Updated timestamp

The projection is updated whenever a snapshot changes. It supports fast course-level lookups, the Rated state, editing, and community aggregation while snapshots preserve history.

Round details use the existing round and round-note concepts where possible. Extend the round data model for favorite hole and companions. A companion references a GolfRank user when selected from friends; a guest companion stores only the minimum display information and never a phone number.

Photo persistence requires a later storage design and is not added in this slice.

## API behavior

Expose a course-rating-oriented API with these responsibilities:

- Load the current user's rating and round details for one course.
- Resolve a comparison candidate from a proposed tier without mutating the saved ranking.
- Atomically save the tier, comparison outcome when applicable, current rating projection, dated round, and nullable golf score. If any part of this core transaction fails, none of it is committed and the course remains unrated.
- Create or update optional note, favorite hole, companions, and sharing choice after the core rating is saved.
- Return a course's community average, rating count, and current user's rating state.

The implementation may reuse the existing ranking engine internally, but the mobile client does not orchestrate several mutating ranking calls. The course-rating endpoint owns the transaction and snapshot update. Optional detail failure never rolls back a confirmed rating and round; the client keeps those unsaved details available for retry.

Community aggregates use each user's current rating projection, not historical snapshots. Revising a rating replaces that user's contribution rather than adding a second rating.

## Privacy and sharing

- Rating details are private by default.
- Sharing requires an explicit user choice at the end of the flow.
- Contact access is requested only after Add guest is chosen.
- Contact phone numbers are used only to hand off to the system SMS composer and are not stored or logged.
- Selecting a contact never sends a message without the user's confirmation in the system composer.

## Error handling

- Preserve all entered form state after a recoverable network error.
- Offer a clear Try again action.
- Do not switch Rate to Rated until the core rating save is confirmed.
- Treat optional detail failures separately from the saved rating and explain which details still need saving.
- Treat contact permission denial as recoverable and return the user to the companion picker.
- Treat SMS cancellation as a normal outcome, not an error.
- Show No ratings yet when aggregate data is absent.

## Accessibility and visual treatment

- Use one primary question per screen, generous spacing, and minimal chrome.
- Do not show a step counter.
- Provide consistent Back, Continue, Skip, and Done actions where applicable.
- Give every option, icon button, error, and derived rating an accessible label.
- Maintain large touch targets, readable contrast, and keyboard-safe layouts on small screens.
- Use a check-circle icon for Rated and an edit-oriented icon for Rate.
- Never rely on color alone to distinguish Green, Fairway, Rough, and Bunker.

## Verification

Backend tests must verify:

- Every derived rating remains within 1-10 and respects the four bands.
- Tier placement and comparison generate deterministic expected ratings.
- Changing a tier updates the current projection and community aggregate.
- Revising a rating replaces, rather than duplicates, the user's aggregate contribution.
- A rating creates a played round even when the golf score is absent.
- Notes, favorite hole, and companions persist and remain private by default.
- Guest phone numbers are never persisted.
- Another user cannot read private rating details.

Frontend tests must verify:

- Unrated courses show Rate and rated courses show check-circle Rated.
- Existing ratings and details are prefilled when reopened.
- Changing a tier invokes comparison when a peer exists; unchanged tiers do not force one.
- Failed saves retain entered state and do not show Rated prematurely.
- Empty community aggregates render No ratings yet.
- Every rating surface uses `/10` and no five-star rating row or five-point demo value remains.
- The photo control communicates its non-persistent first-release state.

Manual device checks must cover contact permission, friend selection, contact selection, editable SMS composition and cancellation, photo placeholder behavior, small-screen layout, keyboard behavior, and screen-reader labels.

## Out of scope

- Direct numeric rating entry
- Photo upload and storage
- Automatic or server-sent guest SMS messages
- A separate Played action or badge
- Public free-form reviews as a separate course-page action
- Bulk ranking reorganization beyond the existing Rankings screen
