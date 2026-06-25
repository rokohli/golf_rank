# GolfRank AI

## Local API


\`\`\`bash
cd services/api
/opt/anaconda3/bin/python -m pip install -e '.[dev]'
/opt/anaconda3/bin/python -m pytest -v
\`\`\`

The API defaults to SQLite for isolated local tests. Docker Compose runs the production-shaped path with PostgreSQL/PostGIS, Redis, Alembic migrations, and deterministic course seed data.

\`\`\`bash
cp .env.example .env
docker compose up --build
curl http://localhost:8000/health
\`\`\`

## Mobile client

\`\`\`bash
cd apps/frontend
npm install
npm test -- --runInBand
npm start
\`\`\`

The development identity header is local-only and must be replaced by Clerk JWT verification before production.
