# Foundation HTTP Contract

## `GET /health`

Returns \`200 {"status":"ok"}\` with an \`X-Request-ID\` response header.

## `PUT /api/v1/me/onboarding-preferences`

Development-only authorization: \`X-Development-Subject: dev:<subject>\`.

Request body:

\`\`\`json
{"home_region":"Monterey, CA","max_green_fee":250,"difficulty":"challenging","access":"public","onboarding_data":{"first_name":"Alice","last_name":"Golfer","username":"alice","home_course_id":"pebble","home_course_search":"Pebble Beach Golf Links","played_course_ids":["pebble"],"favorite_wins":["pebble"],"dream_course_ids":["bandon"],"friend_search":"","preferences":["Scenic views"],"group_size":"Foursome","budget":"$$$","travel_distance":"Up to 45 minutes","preferred_tee_time":"Weekend mornings","transportation":"Cart","notifications":true}}
\`\`\`

Returns the validated preference object. `onboarding_data` is optional for backward compatibility and stores the complete onboarding snapshot when supplied. Invalid fields return \`422\`; missing development identity returns \`401\`.

## `GET /api/v1/me/profile`

Returns the authenticated user's persisted onboarding preferences. Returns \`404\` when they have not completed onboarding.

## `GET /api/v1/courses`

Optional query parameters: \`q\`, \`region\`, \`max_green_fee\`, and \`access\` (`public`, `private`, or `any`). Returns seed-backed course data.
