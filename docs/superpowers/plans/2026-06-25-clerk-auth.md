# Clerk Auth Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clerk authentication to the Expo app and FastAPI API while preserving a development-only no-account bypass for local testing.

**Architecture:** The frontend owns Clerk sign-in/session state and attaches a bearer token to authenticated API requests. The API keeps the existing `CurrentUser` boundary and resolves it either from a verified Clerk JWT or, only in development, from the existing `X-Development-Subject` bypass header. Route handlers must continue depending on `CurrentUser`, not on Clerk-specific request details.

**Tech Stack:** Expo Router, `@clerk/clerk-expo`, `expo-secure-store`, FastAPI, PyJWT/JWKS validation, Pydantic Settings, pytest, Jest, React Native Testing Library, GitHub PR.

---

## Branching and Execution Rules

Start from updated `main`.

```bash
cd /Users/rohankohli/golf_rank
git checkout main
git pull --ff-only origin main
git checkout -b auth-clerk
```

Commit after each task. Do not commit `.env`. Push the branch and open a PR at the end.

The no-account testing bypass must remain available for local development:

- API bypass: `APP_ENV=development` and `ALLOW_DEVELOPMENT_IDENTITY=true` allow `X-Development-Subject: dev:local-user`.
- Frontend bypass: `EXPO_PUBLIC_AUTH_MODE=development` causes the client to send the dev header without requiring a Clerk account.
- Production safety: if `APP_ENV != development`, startup must reject `ALLOW_DEVELOPMENT_IDENTITY=true`; if `EXPO_PUBLIC_AUTH_MODE` is not `development`, frontend must not send the dev header.

---

## File Structure

Create:

- `apps/frontend/src/auth/AuthProvider.tsx` — wraps Clerk in production mode and provides a development bypass session in development mode.
- `apps/frontend/src/auth/useAuthToken.ts` — returns the current API auth headers.
- `apps/frontend/src/auth/__tests__/auth-headers.test.ts` — tests dev bypass and bearer-token header behavior.
- `services/api/tests/test_clerk_auth.py` — tests production/dev auth behavior at the API boundary.

Modify:

- `.env.example` — document Clerk and auth-mode configuration.
- `apps/frontend/package.json` and `package-lock.json` — add Clerk/SecureStore dependencies.
- `apps/frontend/app/_layout.tsx` — wrap app in the auth provider.
- `apps/frontend/app/index.tsx` — require auth unless in dev bypass mode.
- `apps/frontend/src/api/client.ts` — remove hard-coded dev headers; accept/use dynamic auth headers.
- `services/api/pyproject.toml` — add JWT/JWKS dependencies.
- `services/api/app/core/config.py` — add Clerk settings.
- `services/api/app/core/auth.py` — verify Clerk JWTs and preserve development header bypass.
- `services/api/tests/test_auth.py` — extend production safety tests.
- `README.md` — document local bypass and Clerk setup.

---

## Task 1: Add Backend Clerk Settings and Production Safety Tests

**Files:**

- Modify: `services/api/app/core/config.py`
- Modify: `services/api/tests/test_auth.py`
- Modify: `.env.example`

- [ ] **Step 1: Write failing settings tests**

Add these tests to `services/api/tests/test_auth.py`:

```python
import pytest

from app.core.config import Settings


def test_production_rejects_development_identity() -> None:
    with pytest.raises(ValueError, match="development-only"):
        Settings(app_env="production", allow_development_identity=True).validate_security()


def test_production_requires_clerk_issuer_when_dev_identity_disabled() -> None:
    with pytest.raises(ValueError, match="CLERK_ISSUER"):
        Settings(
            app_env="production",
            allow_development_identity=False,
            clerk_issuer=None,
            clerk_jwks_url=None,
        ).validate_security()


def test_development_can_run_with_local_identity_without_clerk() -> None:
    Settings(
        app_env="development",
        allow_development_identity=True,
        clerk_issuer=None,
        clerk_jwks_url=None,
    ).validate_security()
```

If `test_production_rejects_development_identity` already exists, replace it with the block above to avoid duplicate names.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
cd services/api
/opt/anaconda3/bin/python -m pytest tests/test_auth.py -v
```

Expected: failure because `Settings` does not define `clerk_issuer` or `clerk_jwks_url`.

- [ ] **Step 3: Add Clerk settings**

Modify `services/api/app/core/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    allow_development_identity: bool = True
    database_url: str = "sqlite+pysqlite://"
    clerk_issuer: str | None = None
    clerk_jwks_url: str | None = None
    clerk_audience: str | None = None

    def validate_security(self) -> None:
        if self.app_env != "development" and self.allow_development_identity:
            raise ValueError("ALLOW_DEVELOPMENT_IDENTITY is development-only")
        if self.app_env != "development" and not self.clerk_issuer:
            raise ValueError("CLERK_ISSUER is required outside development")
```

- [ ] **Step 4: Document env keys**

Update `.env.example`:

```dotenv
APP_ENV=development
ALLOW_DEVELOPMENT_IDENTITY=true
DATABASE_URL=postgresql+psycopg://golf_rank:golf_rank@db:5432/golf_rank
REDIS_URL=redis://redis:6379/0
EXPO_PUBLIC_API_URL=http://localhost:8000

# Use "development" for no-account local testing. Use "clerk" when testing real auth.
EXPO_PUBLIC_AUTH_MODE=development
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=

# Required when APP_ENV is not development.
CLERK_ISSUER=
CLERK_JWKS_URL=
CLERK_AUDIENCE=
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd services/api
/opt/anaconda3/bin/python -m pytest tests/test_auth.py -v
```

Expected: all auth settings tests pass.

Commit:

```bash
cd /Users/rohankohli/golf_rank
git add .env.example services/api/app/core/config.py services/api/tests/test_auth.py
git commit -m "chore: add Clerk auth configuration"
```

---

## Task 2: Add Backend Clerk JWT Verification Behind `CurrentUser`

**Files:**

- Modify: `services/api/pyproject.toml`
- Modify: `services/api/app/core/auth.py`
- Create: `services/api/tests/test_clerk_auth.py`

- [ ] **Step 1: Add failing auth boundary tests**

Create `services/api/tests/test_clerk_auth.py`:

```python
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, current_user
from app.core.config import Settings


def make_test_app(settings: Settings) -> FastAPI:
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user: CurrentUser = Depends(current_user)) -> dict[str, str]:
        return {"provider_subject": user.provider_subject}

    app.dependency_overrides[Settings] = lambda: settings
    return app


def test_development_header_bypass_still_works() -> None:
    response = TestClient(make_test_app(Settings(app_env="development", allow_development_identity=True))).get(
        "/whoami",
        headers={"X-Development-Subject": "dev:local-user"},
    )

    assert response.status_code == 200
    assert response.json() == {"provider_subject": "dev:local-user"}


def test_production_rejects_missing_bearer_token() -> None:
    response = TestClient(
        make_test_app(
            Settings(
                app_env="production",
                allow_development_identity=False,
                clerk_issuer="https://example.clerk.accounts.dev",
                clerk_jwks_url="https://example.clerk.accounts.dev/.well-known/jwks.json",
            )
        )
    ).get("/whoami")

    assert response.status_code == 401


def test_clerk_bearer_token_resolves_current_user() -> None:
    settings = Settings(
        app_env="production",
        allow_development_identity=False,
        clerk_issuer="https://example.clerk.accounts.dev",
        clerk_jwks_url="https://example.clerk.accounts.dev/.well-known/jwks.json",
    )

    with patch("app.core.auth.verify_clerk_token", return_value="user_123"):
        response = TestClient(make_test_app(settings)).get(
            "/whoami",
            headers={"Authorization": "Bearer test.jwt"},
        )

    assert response.status_code == 200
    assert response.json() == {"provider_subject": "clerk:user_123"}
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
cd services/api
/opt/anaconda3/bin/python -m pytest tests/test_clerk_auth.py -v
```

Expected: failure because `verify_clerk_token` does not exist and `current_user` does not parse bearer tokens.

- [ ] **Step 3: Add JWT dependencies**

Modify `services/api/pyproject.toml` dependencies:

```toml
dependencies = [
    "alembic>=1.13,<2",
    "fastapi>=0.115,<1",
    "uvicorn[standard]>=0.30,<1",
    "sqlalchemy>=2.0,<3",
    "psycopg[binary]>=3.2,<4",
    "pydantic-settings>=2.5,<3",
    "pyjwt[crypto]>=2.8,<3",
    "httpx>=0.27,<1",
]
```

Keep the existing dev dependencies.

- [ ] **Step 4: Implement Clerk verification**

Replace `services/api/app/core/auth.py` with:

```python
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from .config import Settings


@dataclass(frozen=True)
class CurrentUser:
    provider_subject: str


@lru_cache(maxsize=8)
def jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def verify_clerk_token(token: str, settings: Settings) -> str:
    if not settings.clerk_issuer or not settings.clerk_jwks_url:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        signing_key = jwks_client(settings.clerk_jwks_url).get_signing_key_from_jwt(token)
        options = {"verify_aud": bool(settings.clerk_audience)}
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            audience=settings.clerk_audience,
            options=options,
        )
    except (jwt.PyJWTError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    return subject


def current_user(
    authorization: str | None = Header(default=None),
    x_development_subject: str | None = Header(default=None),
) -> CurrentUser:
    settings = Settings()
    settings.validate_security()

    if settings.app_env == "development" and settings.allow_development_identity and x_development_subject:
        if not x_development_subject.startswith("dev:"):
            raise HTTPException(status_code=401, detail="Valid development identity required")
        return CurrentUser(provider_subject=x_development_subject)

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    clerk_subject = verify_clerk_token(authorization.removeprefix("Bearer ").strip(), settings)
    return CurrentUser(provider_subject=f"clerk:{clerk_subject}")
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd services/api
/opt/anaconda3/bin/python -m pytest tests/test_auth.py tests/test_clerk_auth.py tests/test_profiles.py -v
```

Expected: tests pass.

Commit:

```bash
cd /Users/rohankohli/golf_rank
git add services/api/pyproject.toml services/api/app/core/auth.py services/api/tests/test_clerk_auth.py
git commit -m "feat: verify Clerk bearer tokens"
```

---

## Task 3: Add Frontend Auth Header Provider With Development Bypass

**Files:**

- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/package-lock.json`
- Create: `apps/frontend/src/auth/useAuthToken.ts`
- Create: `apps/frontend/src/auth/__tests__/auth-headers.test.ts`
- Modify: `apps/frontend/src/api/client.ts`

- [ ] **Step 1: Install frontend auth dependencies**

Run:

```bash
cd apps/frontend
npm install @clerk/clerk-expo expo-secure-store
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Write failing auth-header tests**

Create `apps/frontend/src/auth/__tests__/auth-headers.test.ts`:

```typescript
import { buildAuthHeaders } from '../useAuthToken'

describe('buildAuthHeaders', () => {
  const originalAuthMode = process.env.EXPO_PUBLIC_AUTH_MODE

  afterEach(() => {
    process.env.EXPO_PUBLIC_AUTH_MODE = originalAuthMode
  })

  it('uses the development identity header in development auth mode', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'development'

    await expect(buildAuthHeaders(async () => null)).resolves.toEqual({
      'Content-Type': 'application/json',
      'X-Development-Subject': 'dev:local-user',
    })
  })

  it('uses a Clerk bearer token outside development auth mode', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'

    await expect(buildAuthHeaders(async () => 'jwt-token')).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
    })
  })

  it('throws when Clerk mode has no active token', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'

    await expect(buildAuthHeaders(async () => null)).rejects.toThrow('Sign in required')
  })
})
```

- [ ] **Step 3: Verify tests fail**

Run:

```bash
cd apps/frontend
npm test -- --runInBand src/auth/__tests__/auth-headers.test.ts
```

Expected: failure because `buildAuthHeaders` does not exist.

- [ ] **Step 4: Implement auth header builder**

Create `apps/frontend/src/auth/useAuthToken.ts`:

```typescript
import { useAuth } from '@clerk/clerk-expo'

export type ApiHeaders = {
  'Content-Type': 'application/json'
  Authorization?: string
  'X-Development-Subject'?: string
}

export async function buildAuthHeaders(getToken: () => Promise<string | null>): Promise<ApiHeaders> {
  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'development') {
    return {
      'Content-Type': 'application/json',
      'X-Development-Subject': 'dev:local-user',
    }
  }

  const token = await getToken()
  if (!token) throw new Error('Sign in required')

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export function useAuthHeaders() {
  const { getToken } = useAuth()

  return {
    getAuthHeaders: () => buildAuthHeaders(() => getToken()),
  }
}
```

- [ ] **Step 5: Modify API client to accept dynamic headers**

Replace `apps/frontend/src/api/client.ts` with:

```typescript
import { ApiHeaders } from '../auth/useAuthToken'
import { Course, OnboardingPreferences } from '../types'

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function savePreferences(input: OnboardingPreferences, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/onboarding-preferences`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error('Unable to save preferences. Please try again.')
}

export async function getProfile(headers: ApiHeaders): Promise<OnboardingPreferences> {
  const response = await fetch(`${baseUrl}/api/v1/me/profile`, {
    headers,
  })
  if (!response.ok) throw new Error('Unable to load profile. Please complete onboarding first.')
  return response.json()
}

export async function searchCourses(filters?: OnboardingPreferences): Promise<Course[]> {
  const params = new URLSearchParams()
  if (filters?.home_region) params.set('region', filters.home_region)
  if (filters?.max_green_fee !== undefined) params.set('max_green_fee', String(filters.max_green_fee))
  if (filters?.difficulty && filters.difficulty !== 'any') params.set('difficulty', filters.difficulty)
  if (filters?.access && filters.access !== 'any') params.set('access', filters.access)

  const query = params.toString()
  const response = await fetch(`${baseUrl}/api/v1/courses${query ? `?${query}` : ''}`)
  if (!response.ok) throw new Error('Unable to load courses. Please try again.')
  return response.json()
}
```

- [ ] **Step 6: Update API client tests**

Modify `apps/frontend/src/api/__tests__/client.test.ts` so `getProfile` is called with headers:

```typescript
import { getProfile, searchCourses } from '../client'

describe('api client', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('passes saved profile preferences as course search filters', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)

    await searchCourses({
      home_region: 'Monterey, CA',
      max_green_fee: 450,
      difficulty: 'challenging',
      access: 'public',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/courses?region=Monterey%2C+CA&max_green_fee=450&difficulty=challenging&access=public',
    )
  })

  it('loads the saved profile for discovery', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        home_region: 'Monterey, CA',
        max_green_fee: 450,
        difficulty: 'challenging',
        access: 'public',
      }),
    } as Response)

    const headers = {
      'Content-Type': 'application/json' as const,
      'X-Development-Subject': 'dev:local-user',
    }

    await expect(getProfile(headers)).resolves.toMatchObject({ max_green_fee: 450 })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/me/profile', { headers })
  })
})
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
cd apps/frontend
npm test -- --runInBand src/auth/__tests__/auth-headers.test.ts src/api/__tests__/client.test.ts
```

Expected: tests pass.

Commit:

```bash
cd /Users/rohankohli/golf_rank
git add apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/src/auth/useAuthToken.ts apps/frontend/src/auth/__tests__/auth-headers.test.ts apps/frontend/src/api/client.ts apps/frontend/src/api/__tests__/client.test.ts
git commit -m "feat: add frontend auth headers"
```

---

## Task 4: Wrap Expo App in Clerk and Gate Authenticated Screens

**Files:**

- Create: `apps/frontend/src/auth/AuthProvider.tsx`
- Modify: `apps/frontend/app/_layout.tsx`
- Modify: `apps/frontend/app/index.tsx`
- Modify: `apps/frontend/app/discover.tsx`
- Modify: `apps/frontend/src/components/__tests__/components.test.tsx`

- [ ] **Step 1: Implement auth provider**

Create `apps/frontend/src/auth/AuthProvider.tsx`:

```tsx
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-expo'
import * as SecureStore from 'expo-secure-store'
import { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key)
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value)
  },
}

function DevelopmentAuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth()
  if (!isLoaded) return null

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#F8FAF7' }}>
          <Text selectable style={{ color: '#102015', fontSize: 30, fontWeight: '800' }}>
            Sign in to GolfRank
          </Text>
          <Text selectable style={{ color: '#53605A', fontSize: 16, lineHeight: 22 }}>
            Clerk is configured, but the sign-in screens are intentionally minimal in this first auth slice.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled
            style={{ alignItems: 'center', backgroundColor: '#C9D2CC', borderRadius: 999, paddingVertical: 16 }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>Sign in setup pending</Text>
          </Pressable>
        </View>
      </SignedOut>
    </>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'development') {
    return <DevelopmentAuthGate>{children}</DevelopmentAuthGate>
  }

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required when EXPO_PUBLIC_AUTH_MODE is not development')
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkAuthGate>{children}</ClerkAuthGate>
    </ClerkProvider>
  )
}
```

This deliberately preserves the no-account path through `EXPO_PUBLIC_AUTH_MODE=development`. A later PR can replace the placeholder signed-out view with polished Clerk sign-in/sign-up screens.

- [ ] **Step 2: Wrap layout**

Modify `apps/frontend/app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router'

import { AuthProvider } from '../src/auth/AuthProvider'

export default function Layout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#F8FAF7' },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#F8FAF7' },
        }}
      />
    </AuthProvider>
  )
}
```

- [ ] **Step 3: Use dynamic auth headers on onboarding**

Modify `apps/frontend/app/index.tsx`:

```tsx
import { Stack, useRouter } from 'expo-router'
import { ScrollView } from 'react-native'

import { savePreferences } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { OnboardingForm } from '../src/components/OnboardingForm'

export default function Index() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()

  return (
    <>
      <Stack.Screen options={{ title: 'GolfRank' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 20 }}
      >
        <OnboardingForm
          submit={async (input) => savePreferences(input, await getAuthHeaders())}
          onComplete={() => router.replace('/discover')}
        />
      </ScrollView>
    </>
  )
}
```

- [ ] **Step 4: Use dynamic auth headers on discovery**

Modify `apps/frontend/app/discover.tsx`:

```tsx
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { getProfile, searchCourses } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { CourseList } from '../src/components/CourseList'
import { Course } from '../src/types'

export default function Discover() {
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)
  const { getAuthHeaders } = useAuthHeaders()

  useEffect(() => {
    getAuthHeaders()
      .then(getProfile)
      .then(searchCourses)
      .then(setCourses)
      .catch((reason: Error) => setError(reason.message))
  }, [getAuthHeaders])

  return (
    <>
      <Stack.Screen options={{ title: 'Discover courses' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, paddingTop: 20, gap: 16 }}
      >
        <View style={{ gap: 6 }}>
          <Text selectable style={{ fontSize: 28, fontWeight: '700', color: '#102015' }}>
            Discover courses
          </Text>
          <Text selectable style={{ fontSize: 16, lineHeight: 22, color: '#53605A' }}>
            Seeded local course data filtered through the API.
          </Text>
        </View>
        {error ? (
          <Text accessibilityRole="alert" selectable style={{ color: '#B42318' }}>
            {error}
          </Text>
        ) : (
          <CourseList courses={courses} />
        )}
      </ScrollView>
    </>
  )
}
```

- [ ] **Step 5: Verify frontend tests**

Run:

```bash
cd apps/frontend
npm test -- --runInBand
npx expo-doctor
```

Expected: all Jest tests pass and Expo Doctor reports `18/18 checks passed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/rohankohli/golf_rank
git add apps/frontend/app/_layout.tsx apps/frontend/app/index.tsx apps/frontend/app/discover.tsx apps/frontend/src/auth/AuthProvider.tsx
git commit -m "feat: wire Clerk provider into Expo app"
```

---

## Task 5: Update Documentation and Full Verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Document no-account local testing**

Add this section to `README.md`:

```markdown
## Authentication modes

Local development can run without a Clerk account:

```bash
EXPO_PUBLIC_AUTH_MODE=development
APP_ENV=development
ALLOW_DEVELOPMENT_IDENTITY=true
```

In this mode, the frontend sends:

```http
X-Development-Subject: dev:local-user
```

The API rejects this bypass outside development.

To test real Clerk auth, configure:

```bash
EXPO_PUBLIC_AUTH_MODE=clerk
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<from Clerk dashboard>
CLERK_ISSUER=<from Clerk dashboard>
CLERK_JWKS_URL=<issuer>/.well-known/jwks.json
ALLOW_DEVELOPMENT_IDENTITY=false
```
```

- [ ] **Step 2: Run full verification**

Run:

```bash
cd /Users/rohankohli/golf_rank/services/api
/opt/anaconda3/bin/python -m pytest -v
```

Expected: all API tests pass.

Run:

```bash
cd /Users/rohankohli/golf_rank/apps/frontend
npm test -- --runInBand
npx expo-doctor
```

Expected: all frontend tests pass and Expo Doctor reports no issues.

Run:

```bash
cd /Users/rohankohli/golf_rank
docker compose up --build -d
curl --fail --silent --show-error http://localhost:8000/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 3: Commit docs**

```bash
cd /Users/rohankohli/golf_rank
git add README.md
git commit -m "docs: document auth modes"
```

---

## Task 6: Push Branch and Open Pull Request

**Files:** none.

- [ ] **Step 1: Confirm clean state**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Push branch**

Run:

```bash
git push -u origin auth-clerk
```

Expected: branch pushed to GitHub.

- [ ] **Step 3: Open PR**

Use GitHub UI or CLI.

CLI option:

```bash
gh pr create \
  --base main \
  --head auth-clerk \
  --title "Add Clerk auth boundary" \
  --body "$(cat <<'EOF'
## Summary
- Adds Clerk-aware auth configuration and backend bearer-token boundary.
- Preserves development-only no-account bypass for local testing.
- Wires Expo API calls to dynamic auth headers instead of hard-coded dev headers.

## Test Plan
- [ ] cd services/api && /opt/anaconda3/bin/python -m pytest -v
- [ ] cd apps/frontend && npm test -- --runInBand
- [ ] cd apps/frontend && npx expo-doctor
- [ ] docker compose up --build -d && curl --fail --silent --show-error http://localhost:8000/health

## Local bypass
Set EXPO_PUBLIC_AUTH_MODE=development, APP_ENV=development, and ALLOW_DEVELOPMENT_IDENTITY=true to test without creating a Clerk account.
EOF
)"
```

If `gh` is not authenticated, open:

```text
https://github.com/rokohli/golf_rank/pull/new/auth-clerk
```

---

## Acceptance Criteria

- Local no-account testing still works through development auth mode.
- Production mode rejects development identity bypass.
- Frontend no longer hard-codes `X-Development-Subject` in the API client.
- Authenticated API calls can carry `Authorization: Bearer <Clerk JWT>`.
- `/me` route handlers still depend only on `CurrentUser`.
- API tests pass.
- Frontend tests pass.
- Expo Doctor passes.
- Docker Compose API health check passes.
- PR is opened against `main`.
