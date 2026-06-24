# GolfRank AI Month 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable Expo onboarding/course-discovery client backed by FastAPI, PostgreSQL/PostGIS, and Redis.

**Architecture:** `apps/frontend` owns Expo Router screens and calls a versioned HTTP API. `services/api` owns Pydantic validation, provider-neutral current-user resolution, SQLAlchemy persistence, and course queries. Docker Compose runs Postgres, Redis, and the API; Expo runs directly on the host.

**Tech Stack:** Expo Router, TypeScript, React Native Testing Library, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL/PostGIS, Redis, pytest, Docker Compose.

---

## File Structure

```text
.gitignore, .env.example, docker-compose.yml, README.md
apps/frontend/app/{_layout,index,discover}.tsx
apps/frontend/src/{api/client,components/OnboardingForm,components/CourseList,types}.ts
apps/frontend/__tests__/{OnboardingForm,CourseList}.test.tsx
services/api/app/{main,db,models,schemas,seed}.py
services/api/app/core/{config,auth}.py
services/api/app/routes/{profiles,courses}.py
services/api/{pyproject.toml,Dockerfile,alembic.ini,alembic/versions/0001_initial.py}
services/api/tests/{conftest,test_health,test_auth,test_profiles,test_courses}.py
packages/contracts/openapi.md
```

### Task 1: Initialize repository and API shell

**Files:**
- Create: `.gitignore`, `.env.example`, `docker-compose.yml`, `services/api/pyproject.toml`, `services/api/Dockerfile`, `services/api/app/main.py`
- Test: `services/api/tests/test_health.py`

- [ ] **Step 1: Initialize Git and write the failing health test**

```bash
git init
mkdir -p services/api/app services/api/tests
```

```python
# services/api/tests/test_health.py
from fastapi.testclient import TestClient
from app.main import create_app

def test_health_returns_ok_with_request_id() -> None:
    response = TestClient(create_app()).get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
    assert response.headers['x-request-id']
```

- [ ] **Step 2: Verify the test fails**

Run: `cd services/api && pytest tests/test_health.py -v`

Expected: collection failure because `app.main` does not exist.

- [ ] **Step 3: Add dependencies and local containers**

```toml
# services/api/pyproject.toml
[project]
name = 'golf-rank-api'
version = '0.1.0'
requires-python = '>=3.12'
dependencies = ['fastapi>=0.115,<1', 'uvicorn[standard]>=0.30,<1', 'sqlalchemy>=2.0,<3', 'psycopg[binary]>=3.2,<4', 'pydantic-settings>=2.5,<3']
[project.optional-dependencies]
dev = ['pytest>=8,<9', 'httpx>=0.27,<1']
[tool.pytest.ini_options]
pythonpath = ['.']
```

```yaml
# docker-compose.yml
services:
  db:
    image: postgis/postgis:16-3.4
    environment: { POSTGRES_DB: golf_rank, POSTGRES_USER: golf_rank, POSTGRES_PASSWORD: golf_rank }
    ports: ['5432:5432']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U golf_rank -d golf_rank']
      interval: 5s
      timeout: 3s
      retries: 20
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
  api:
    build: ./services/api
    env_file: .env
    ports: ['8000:8000']
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_started }
```

```dotenv
# .env.example
APP_ENV=development
ALLOW_DEVELOPMENT_IDENTITY=true
DATABASE_URL=postgresql+psycopg://golf_rank:golf_rank@db:5432/golf_rank
REDIS_URL=redis://redis:6379/0
EXPO_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 4: Implement the factory and health route**

```python
# services/api/app/main.py
from uuid import uuid4
from fastapi import FastAPI, Request

def create_app() -> FastAPI:
    app = FastAPI(title='GolfRank API')
    @app.middleware('http')
    async def request_id(request: Request, call_next):
        response = await call_next(request)
        response.headers['X-Request-ID'] = request.headers.get('X-Request-ID', str(uuid4()))
        return response
    @app.get('/health')
    def health() -> dict[str, str]:
        return {'status': 'ok'}
    return app

app = create_app()
```

- [ ] **Step 5: Verify and commit**

Run: `cd services/api && pytest tests/test_health.py -v`

Expected: `1 passed`.

```bash
git add . && git commit -m 'chore: initialize API and local stack'
```

### Task 2: Add configuration, persistence, and migration

**Files:**
- Create: `services/api/app/core/config.py`, `services/api/app/db.py`, `services/api/app/models.py`, `services/api/alembic/versions/0001_initial.py`
- Test: `services/api/tests/test_models.py`

- [ ] **Step 1: Write the failing unique-preferences test**

```python
def test_user_has_one_onboarding_preference(session) -> None:
    user = User(provider_subject='dev:alice')
    session.add(user); session.flush()
    session.add_all([OnboardingPreference(user_id=user.id), OnboardingPreference(user_id=user.id)])
    with pytest.raises(IntegrityError):
        session.commit()
```

- [ ] **Step 2: Verify it fails**

Run: `cd services/api && pytest tests/test_models.py -v`

Expected: collection error because `User` is undefined.

- [ ] **Step 3: Implement schema-bearing models**

```python
# services/api/app/models.py
from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase): pass
class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_subject: Mapped[str] = mapped_column(String(255), unique=True, index=True)
class Profile(Base):
    __tablename__ = 'profiles'
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), primary_key=True)
    home_region: Mapped[str] = mapped_column(String(120))
class OnboardingPreference(Base):
    __tablename__ = 'onboarding_preferences'
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), primary_key=True)
    max_green_fee: Mapped[int] = mapped_column(Integer)
    difficulty: Mapped[str] = mapped_column(String(20))
    access: Mapped[str] = mapped_column(String(20))
class Course(Base):
    __tablename__ = 'courses'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    region: Mapped[str] = mapped_column(String(120), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    is_public: Mapped[bool] = mapped_column(Boolean, index=True)
    difficulty: Mapped[str] = mapped_column(String(20), index=True)
    green_fee: Mapped[int] = mapped_column(Integer, index=True)
```

- [ ] **Step 4: Add SQLAlchemy setup and an initial Alembic migration**

```python
# services/api/app/db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .core.config import Settings
engine = create_engine(Settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
```

The migration creates the four listed tables, both foreign keys, unique `users.provider_subject`, and the five listed course indexes.

- [ ] **Step 5: Verify and commit**

Run: `cd services/api && pytest tests/test_models.py -v && alembic upgrade head`

Expected: test passes and Alembic upgrades to `0001_initial`.

```bash
git add services/api && git commit -m 'feat: add foundation database schema'
```

### Task 3: Add a Clerk-compatible identity boundary and onboarding API

**Files:**
- Create: `services/api/app/core/auth.py`, `services/api/app/schemas.py`, `services/api/app/routes/profiles.py`
- Modify: `services/api/app/main.py`
- Test: `services/api/tests/test_auth.py`, `services/api/tests/test_profiles.py`

- [ ] **Step 1: Write failing endpoint and configuration tests**

```python
def test_onboarding_upserts_current_user_preferences(client) -> None:
    response = client.put('/api/v1/me/onboarding-preferences',
        headers={'X-Development-Subject': 'dev:alice'},
        json={'home_region':'Monterey, CA','max_green_fee':250,'difficulty':'challenging','access':'public'})
    assert response.status_code == 200
    assert response.json()['home_region'] == 'Monterey, CA'

def test_production_rejects_development_identity() -> None:
    with pytest.raises(ValueError, match='development-only'):
        Settings(app_env='production', allow_development_identity=True).validate_security()
```

- [ ] **Step 2: Verify tests fail because the endpoint is absent**

Run: `cd services/api && pytest tests/test_auth.py tests/test_profiles.py -v`

Expected: `404` from the endpoint test.

- [ ] **Step 3: Implement the adapter seam and validation**

```python
# services/api/app/core/auth.py
from dataclasses import dataclass
from fastapi import Header, HTTPException
from .config import Settings
@dataclass(frozen=True)
class CurrentUser:
    provider_subject: str
def current_user(x_development_subject: str | None = Header(default=None)) -> CurrentUser:
    settings = Settings()
    if settings.app_env != 'development' or not settings.allow_development_identity:
        raise HTTPException(401, 'Authentication required')
    if not x_development_subject or not x_development_subject.startswith('dev:'):
        raise HTTPException(401, 'Valid development identity required')
    return CurrentUser(x_development_subject)
```

```python
# services/api/app/schemas.py
from pydantic import BaseModel, Field
class OnboardingPreferencesIn(BaseModel):
    home_region: str = Field(min_length=2, max_length=120)
    max_green_fee: int = Field(ge=0, le=2000)
    difficulty: str = Field(pattern='^(beginner|intermediate|challenging|any)$')
    access: str = Field(pattern='^(public|private|any)$')
class ProfileOut(OnboardingPreferencesIn): pass
```

The route resolves/creates its user by `CurrentUser.provider_subject`, updates only that user's `Profile` and `OnboardingPreference` in one transaction, and returns `ProfileOut`. Include the router under `/api/v1/me`.

- [ ] **Step 4: Verify and commit**

Run: `cd services/api && pytest tests/test_auth.py tests/test_profiles.py -v`

Expected: all tests pass.

```bash
git add services/api && git commit -m 'feat: add provider-neutral onboarding API'
```

### Task 4: Add seeded course discovery

**Files:**
- Create: `services/api/app/routes/courses.py`, `services/api/app/seed.py`
- Modify: `services/api/app/main.py`, `services/api/app/schemas.py`
- Test: `services/api/tests/test_courses.py`

- [ ] **Step 1: Write the failing filter test**

```python
def test_course_search_filters_by_region_fee_and_access(client, seeded_courses) -> None:
    response = client.get('/api/v1/courses', params={
        'q':'Pebble', 'region':'Monterey, CA', 'max_green_fee':700, 'access':'public'})
    assert response.status_code == 200
    assert [course['name'] for course in response.json()] == ['Pebble Beach Golf Links']
```

- [ ] **Step 2: Verify it fails**

Run: `cd services/api && pytest tests/test_courses.py -v`

Expected: assertion failure because the route returns `404`.

- [ ] **Step 3: Implement query filtering**

```python
# services/api/app/routes/courses.py
@router.get('')
def list_courses(q: str | None = None, region: str | None = None,
                 max_green_fee: int | None = Query(None, ge=0),
                 access: str = 'any', session: Session = Depends(get_session)):
    statement = select(Course)
    if q: statement = statement.where(Course.name.ilike(f'%{q}%'))
    if region: statement = statement.where(Course.region == region)
    if max_green_fee is not None: statement = statement.where(Course.green_fee <= max_green_fee)
    if access != 'any': statement = statement.where(Course.is_public == (access == 'public'))
    return list(session.scalars(statement.order_by(Course.name)).all())
```

Create an idempotent seed that inserts Pebble Beach Golf Links, Spyglass Hill Golf Course, and Pasatiempo Golf Club. Return an explicit response schema rather than ORM objects.

- [ ] **Step 4: Verify and commit**

Run: `cd services/api && pytest tests/test_courses.py -v`

Expected: `1 passed`.

```bash
git add services/api && git commit -m 'feat: add seeded course discovery API'
```

### Task 5: Scaffold Expo onboarding and discovery

**Files:**
- Create: `apps/frontend/package.json`, `apps/frontend/app/_layout.tsx`, `apps/frontend/app/index.tsx`, `apps/frontend/app/discover.tsx`, `apps/frontend/src/api/client.ts`, `apps/frontend/src/types.ts`, `apps/frontend/src/components/OnboardingForm.tsx`, `apps/frontend/src/components/CourseList.tsx`
- Test: `apps/frontend/__tests__/OnboardingForm.test.tsx`, `apps/frontend/__tests__/CourseList.test.tsx`

- [ ] **Step 1: Write the failing onboarding submit test**

```tsx
it('submits preferences and continues to discovery', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const onComplete = jest.fn()
  const screen = render(<OnboardingForm submit={submit} onComplete={onComplete} />)
  await userEvent.type(screen.getByLabelText('Home region'), 'Monterey, CA')
  await userEvent.press(screen.getByText('Save preferences'))
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({home_region: 'Monterey, CA'})))
  expect(onComplete).toHaveBeenCalled()
})
```

- [ ] **Step 2: Verify it fails**

Run: `cd apps/frontend && npm test -- OnboardingForm.test.tsx`

Expected: module-not-found error for `OnboardingForm`.

- [ ] **Step 3: Add Expo dependencies and typed client**

```json
{"private":true,"scripts":{"start":"expo start","test":"jest"},"dependencies":{"expo":"~53.0.0","expo-router":"~5.0.0","react":"19.0.0","react-native":"0.79.0"},"devDependencies":{"@testing-library/react-native":"^13.0.0","jest-expo":"~53.0.0","typescript":"~5.8.0"}}
```

```ts
export async function savePreferences(input: OnboardingPreferences): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/onboarding-preferences`, {
    method: 'PUT', headers, body: JSON.stringify(input) })
  if (!response.ok) throw new Error('Unable to save preferences. Please try again.')
}
```

- [ ] **Step 4: Implement both screens**

The form has controlled fields for region, budget, difficulty, and access; disable submit while saving; render errors in a `Text` element with `accessibilityRole="alert"`. On success `app/index.tsx` calls `router.replace('/discover')`. Discovery calls `searchCourses` on mount and renders a course list, empty state, or equivalent visible request error.

- [ ] **Step 5: Verify and commit**

Run: `cd apps/frontend && npm install && npm test -- --runInBand`

Expected: onboarding and list tests pass.

```bash
git add apps/frontend && git commit -m 'feat: add Expo onboarding and discovery'
```

### Task 6: Document and verify the working foundation

**Files:**
- Create: `packages/contracts/openapi.md`
- Modify: `README.md`
- Test: complete API and frontend suites

- [ ] **Step 1: Document the API contract**

For each endpoint, document method, path, authorization, query/body schema, example successful JSON, and `401`, `422`, and `500` errors. Include the development identity header as development-only and state that Clerk JWT verification replaces it before production.

- [ ] **Step 2: Write exact setup instructions**

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec api alembic upgrade head
docker compose exec api python -m app.seed
cd services/api && pytest -v
cd ../../apps/frontend && npm install && npm test -- --runInBand
```

- [ ] **Step 3: Run full verification and commit**

Run: `docker compose up --build -d && cd services/api && pytest -v && cd ../../apps/frontend && npm test -- --runInBand`

Expected: healthy local containers and passing API/mobile suites.

```bash
git add README.md packages/contracts && git commit -m 'docs: document foundation API contract'
```

## Self-Review

- Spec coverage: Tasks 1–2 provide local infrastructure, configuration, health, request IDs, models, and migrations. Tasks 3–4 provide the protected user path, onboarding upsert, seed data, and course filters. Task 5 provides the two mobile routes and visible errors. Task 6 provides contract and end-to-end instructions.
- Excluded systems remain excluded: reviews, rankings, social graph, agents, embeddings, uploads, notifications, and hosted deployment.
- Names are consistent: `provider_subject`, `home_region`, `max_green_fee`, `difficulty`, `access`, and `/api/v1/courses`.

