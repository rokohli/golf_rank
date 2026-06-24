# GolfRank AI

## Local API


\`\`\`bash
cd services/api
/opt/anaconda3/bin/python -m pip install -e '.[dev]'
/opt/anaconda3/bin/python -m pytest -v
\`\`\`

The current API runs its deterministic seed with SQLite for local test isolation. Docker Compose includes PostgreSQL/PostGIS and Redis as the next persistence/runtime target. Copy \`.env.example\` to \`.env\` before starting containers.

## Mobile client

\`\`\`bash
cd apps/frontend
npm install
npm start
\`\`\`

The development identity header is local-only and must be replaced by Clerk JWT verification before production.
