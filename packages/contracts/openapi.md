# Foundation HTTP Contract

## `GET /health`

Returns \`200 {"status":"ok"}\` with an \`X-Request-ID\` response header.

## `PUT /api/v1/me/onboarding-preferences`

Development-only authorization: \`X-Development-Subject: dev:<subject>\`.

Request body:

\`\`\`json
{"home_region":"Monterey, CA","max_green_fee":250,"difficulty":"challenging","access":"public"}
\`\`\`

Returns the validated preference object. Invalid fields return \`422\`; missing development identity returns \`401\`.

## `GET /api/v1/me/profile`

Returns the authenticated user's persisted onboarding preferences. Returns \`404\` when they have not completed onboarding.

## `GET /api/v1/courses`

Optional query parameters: \`q\`, \`region\`, \`max_green_fee\`, and \`access\` (`public`, `private`, or `any`). Returns seed-backed course data.
