# Foundation HTTP Contract

## `GET /health`

Returns `200 {"status":"ok"}` with an `X-Request-ID` response header.

## `PUT /api/v1/me/onboarding-preferences`

Development-only authorization: `X-Development-Subject: dev:<subject>`.

Request body:

```json
{"home_region":"Monterey, CA","max_green_fee":250,"difficulty":"challenging","access":"public","onboarding_data":{"first_name":"Alice","last_name":"Golfer","username":"alice","home_course_id":"pebble","home_course_search":"Pebble Beach Golf Links","played_course_ids":["pebble"],"favorite_wins":["pebble"],"dream_course_ids":["bandon"],"friend_search":"","preferences":["Scenic views"],"group_size":"Foursome","budget":"$$$","travel_distance":"Up to 45 minutes","preferred_tee_time":"Weekend mornings","transportation":"Cart","notifications":true}}
```

Returns the validated preference object. `onboarding_data` is optional for backward compatibility and stores the complete onboarding snapshot when supplied. Invalid fields return `422`; missing development identity returns `401`.

## `GET /api/v1/me/profile`

Returns the authenticated user's persisted onboarding preferences. Returns `404` when they have not completed onboarding.

## `GET /api/v1/courses`

Optional query parameters: `q`, legacy free-form `region`, normalized `country`, `admin1`, `city`, `lat`, `lng`, `radius_miles`, stable numeric `cursor`, `limit`, `max_green_fee`, `difficulty`, and `access` (`public`, `private`, or `any`). `lat` and `lng` must be supplied together; radius defaults to 50 miles when coordinates are supplied. No authentication is required. Returns active canonical catalog records in stable ID order with nullable commercial metadata and the community aggregate:

```json
[
  {
    "id": 1,
    "name": "Pebble Beach Golf Links",
    "region": "Monterey, CA",
    "green_fee": 675,
    "difficulty": "challenging",
    "is_public": true,
    "latitude": 36.568,
    "longitude": -121.949,
    "source": "opengolfapi",
    "country_code": "US",
    "admin1_code": "CA",
    "admin1_name": "California",
    "city": "Monterey",
    "status": "active",
    "hole_count": 18,
    "access": "public",
    "community_rating": 9.2,
    "rating_count": 1
  }
]
```

`community_rating` is the one-decimal average of current personal ratings and is `null` when nobody has rated the course. `rating_count` is the number of current personal ratings and is `0` when unrated.

`green_fee`, `difficulty`, `access`, and `is_public` may be `null` when the provider does not supply trustworthy values. Clients must display an unavailable state rather than invent defaults.

## `GET /api/v1/course-regions`

Returns normalized country, admin-area, and city combinations with counts of active courses. The Discover UI uses this response for region suggestions and counts.

## `POST /api/v1/course-candidates`

Creates an authenticated pending catalog-review candidate with `name`, optional `city`, `admin1_code`, and `notes`. Provider lookup results are not inserted directly into the canonical catalog.

## Social graph and feed

- `GET /api/v1/users?q=...` searches golfers without exposing provider identities and excludes blocks in either direction.
- `PUT` and `DELETE /api/v1/me/follows/{user_id}` manage one-way follows. Mutual follows are presented as Friends.
- `GET /api/v1/me/follows` returns followed-user envelopes with `is_mutual`.
- `PUT` and `DELETE /api/v1/me/mutes/{user_id}` hide or restore a followed user's feed activity.
- `PUT` and `DELETE /api/v1/me/blocks/{user_id}` hide both users from search/feed and remove follows in both directions.

`GET /api/v1/feed?limit=20&cursor=...` returns a privacy-filtered cursor page:

```json
{
  "items": [{
    "id": 9,
    "event_type": "course_rated",
    "subject_type": "rating_round",
    "subject_id": 42,
    "actor": {"id": 2, "username": "maya", "display_name": "Maya Golfer", "home_region": "San Diego, CA", "follower_count": 3, "following_count": 4},
    "course": {"id": 1, "name": "Pebble Beach Golf Links", "region": "Monterey, CA"},
    "data": {"course_id": 1, "played_on": "2026-07-01", "score": 82, "rating": 9.4, "tier": "green"},
    "reaction_count": 2,
    "viewer_reacted": true,
    "created_at": "2026-07-15T12:00:00Z"
  }],
  "next_cursor": null
}
```

Friends-visible events require a mutual follow; public events require the viewer to follow the actor; private events are visible only to their actor. Rating and re-rating through the course-rating endpoint create `course_rated` events. Ranking-refinement tier/comparison writes do not create social events.

`PUT` and `DELETE /api/v1/feed/{event_id}/reactions/like` idempotently add or remove a like and return the updated count/viewer state. Reactions are allowed only when the requesting user can view the event.

## `GET /api/v1/courses/{course_id}`

No authentication is required. Returns the same course shape, including `community_rating` and `rating_count`, for one course. A missing course returns `404`.

## Rating tiers

The canonical display names and wire values are:

| Display name | Wire value | Personal-rating range |
| --- | --- | --- |
| Green | `green` | 8.5-10.0 |
| Fairway | `fairway` | 7.0-8.4 |
| Rough | `rough` | 5.0-6.9 |
| Bunker | `bunker` | 1.0-4.9 |

The rating endpoints below require either `Authorization: Bearer <Clerk JWT>` or, only when development identity is enabled, `X-Development-Subject: dev:<subject>`. Missing or invalid authentication returns `401`.

## `GET /api/v1/me/course-ratings/{course_id}`

Returns the authenticated user's rating state plus the public community aggregate:

```json
{
  "course": {
    "id": 1,
    "name": "Pebble Beach Golf Links",
    "region": "Monterey, CA",
    "green_fee": 675,
    "difficulty": "challenging",
    "is_public": true,
    "community_rating": 9.2,
    "rating_count": 1
  },
  "personal_rating": 9.2,
  "tier": "green",
  "confidence": 0.35,
  "community_rating": 9.2,
  "rating_count": 1,
  "round": {
    "id": 42,
    "played_on": "2026-07-01",
    "score": 82,
    "note": "Fast greens",
    "favorite_hole": 7,
    "visibility": "friends"
  },
  "companions": [
    {"friend_user_id": 22, "guest_name": null},
    {"friend_user_id": null, "guest_name": "Alex"}
  ]
}
```

`confidence` is a normalized ranking-confidence signal from `0` through `1`; higher values mean the ranking has stronger placement and comparison evidence. It is `null` when the user has no current rating for the course. Clients should treat it as a continuous signal rather than depend on a fixed number of decimal places.

For an unrated course, `personal_rating`, `tier`, `confidence`, and `round` are `null`. The top-level `companions` array is empty. Community fields remain available and may reflect other users' ratings. A missing course returns `404`.

## `GET /api/v1/me/course-ratings/{course_id}/comparison-candidate?tier={tier}`

`tier` is required and must be `green`, `fairway`, `rough`, or `bunker`. Returns a course in that tier from the authenticated user's existing tier assignments, excluding `course_id`, with the standard course fields and community aggregate:

```json
{
  "id": 2,
  "name": "Spyglass Hill Golf Course",
  "region": "Monterey, CA",
  "green_fee": 495,
  "difficulty": "challenging",
  "is_public": true,
  "community_rating": 8.8,
  "rating_count": 4
}
```

Returns JSON `null` with status `200` when there is no candidate or the authenticated identity does not yet have a stored user. The lookup is read-only. A missing target course returns `404`; an invalid or missing tier returns `422`.

## `PUT /api/v1/me/course-ratings/{course_id}`

Atomically creates or revises the authenticated user's rating and its rating-owned round. Rating a course implies that the course was played: the request requires `played_on` and creates or updates one round marked internally as a rating round. Revisions reuse that round.

Request body:

```json
{
  "tier": "green",
  "played_on": "2026-07-01",
  "score": 82
}
```

- `tier` is one of the four canonical wire values above.
- `played_on` is an ISO `YYYY-MM-DD` date and cannot be in the future.
- `score` is optional and nullable; when supplied it must be an integer from 40 through 250.
- `comparison_course_id` and `comparison_result` are optional, but must be supplied together. `comparison_result` is one of `course_a`, `course_b`, `too_close`, or `not_sure`; course A is the `course_id` in the URL. The comparison course must be a different existing course already assigned to the same tier for this user.

PUT uses replacement semantics for these optional fields when revising an existing rating. If `score` is omitted, its schema default is `null` and the existing round score is cleared. If both comparison fields are omitted, no new comparison record is added. Existing historical comparison records are not deleted; they remain available to the ranking algorithm, including its confidence calculation.

Example request with a comparison:

```json
{
  "tier": "green",
  "played_on": "2026-07-01",
  "score": null,
  "comparison_course_id": 2,
  "comparison_result": "course_a"
}
```

Returns `200` with the complete rating-state shape documented for GET. A new rating round has `visibility: "private"`, `note: null`, and `favorite_hole: null`; the response's top-level `companions` array is empty. Validation errors return `422`; an invalid same-tier comparison returns `409`; a missing course returns `404`. The rating, round, ranking projection, optional comparison, community aggregate, and activity event are committed or rolled back together.

## `PATCH /api/v1/me/course-ratings/{course_id}/details`

Replaces the detail set attached to an existing rating round:

```json
{
  "note": "Fast greens",
  "favorite_hole": 7,
  "friend_user_ids": [22],
  "guest_names": ["Alex"],
  "visibility": "friends"
}
```

- `note` is nullable and limited to 5,000 characters. `null` removes an existing note.
- `favorite_hole` is nullable and, when supplied, is an integer from 1 through 18.
- `friend_user_ids` accepts at most 40 existing user IDs, all of whom the authenticated user must follow.
- `guest_names` accepts at most 20 nonblank names, each at most 120 characters after trimming.
- `visibility` is only `private` or `friends`.

All fields have defaults, so omitted fields are replaced with `null`, empty lists, or `private` rather than retained. Rating details are private by default at the product level; sharing with friends must be selected explicitly. Unknown fields are rejected. In particular, phone numbers are neither accepted nor stored: contact selection and SMS invitations stay on the client, and the API receives guest display names only. The note-photo control is currently a client-side "Coming soon" placeholder; photo upload is not part of this API contract.

Returns `200` with the complete rating-state shape documented for GET, including the updated round and companions. Returns `404` when the course, rating, rating-owned round, or stored user does not exist; invalid detail data or friend IDs return `422`.

## Error response bodies

Authentication and route business errors raised by the API use a string `detail`, for example:

```json
{"detail":"Course not found"}
```

This shape is used for statuses such as `401`, `404`, and `409`, and also for route-level `422` business rules such as comparing a course with itself or supplying a user ID that is not followed.

Request parsing and schema validation failures use status `422` with an array in `detail`. Each item identifies the input location and validation failure; additional keys such as `input` and `ctx` may be present:

```json
{
  "detail": [
    {
      "type": "greater_than_equal",
      "loc": ["body", "score"],
      "msg": "Input should be greater than or equal to 40",
      "input": 39,
      "ctx": {"ge": 40}
    }
  ]
}
```
