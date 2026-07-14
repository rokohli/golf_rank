# Rating Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean, comparison-driven course rating flow, persist current personal ratings and round memories, and convert every rating surface from five stars to an explicit ten-point scale.

**Architecture:** Keep tier assignments, comparisons, and immutable snapshots as the ranking engine. Add a current `UserCourseRating` projection and a course-rating API that saves tier, comparison, dated round, and projection in one transaction; optional memories are patched afterward. The Expo app uses a focused route and reusable flow component, while course cards consume community aggregates and never render star ratings.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL/SQLite, pytest, Expo Router 5, React Native 0.79, TypeScript, Jest, Testing Library, `expo-contacts`, and `expo-sms`.

---

## File map

- Create `services/api/alembic/versions/0005_rating_experience.py`: migrate golf tiers and add current ratings, favorite hole, and companions.
- Modify `services/api/app/models.py`: declare `UserCourseRating` and `RoundCompanion`; extend `Round`.
- Modify `services/api/app/schemas.py`: expose golf tiers and community rating fields.
- Modify `services/api/app/ranking.py`: rename tiers, remove internal commits, and maintain current projections.
- Create `services/api/app/course_ratings.py`: own candidate lookup, atomic rating save, state retrieval, and optional-detail updates.
- Modify `services/api/app/main.py`: register the rating router and return aggregate course data.
- Create `services/api/tests/test_course_ratings.py`: cover transactionality, privacy, aggregates, edits, companions, and legacy tier compatibility.
- Modify `services/api/tests/test_rankings.py`: assert golf tier names and unchanged ten-point bands.
- Modify `apps/frontend/src/types.ts`: add course-rating, aggregate, round-detail, friend, and golf-tier types.
- Modify `apps/frontend/src/api/client.ts`: add course-rating and friend API calls.
- Modify `apps/frontend/src/api/__tests__/client.test.ts`: verify authenticated rating requests.
- Create `apps/frontend/src/components/RatingFlow.tsx`: implement the focused, stateful guided experience.
- Create `apps/frontend/src/components/__tests__/RatingFlow.test.tsx`: cover tier, score, comparison, reveal, retry, and optional details.
- Create `apps/frontend/app/rate/[id].tsx`: load the API course and host `RatingFlow`.
- Modify `apps/frontend/app/course/[id].tsx`: load rating state and wire Rate/Rated navigation.
- Modify `apps/frontend/src/components/ProductUI.tsx`, `apps/frontend/src/data/demo.ts`, `apps/frontend/app/discover.tsx`, `apps/frontend/app/home.tsx`, `apps/frontend/app/profile.tsx`, `apps/frontend/app/rankings.tsx`, and `apps/frontend/src/components/GetStartedScreen.tsx`: remove five-star presentation and use `/10`.
- Modify `apps/frontend/package.json`, `apps/frontend/package-lock.json`, and `apps/frontend/app.json`: install/configure Contacts and SMS capabilities.

### Task 1: Persist current ratings and golf memories

**Files:**
- Create: `services/api/alembic/versions/0005_rating_experience.py`
- Modify: `services/api/app/models.py`
- Test: `services/api/tests/test_models.py`

- [ ] **Step 1: Write the failing model test**

Add the required imports, then create one current rating, one round with favorite hole, one friend companion, and one guest companion:

```python
def test_rating_projection_and_round_companions() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        course = Course(name="Pebble", region="CA", latitude=1, longitude=1, is_public=True, difficulty="challenging", green_fee=100)
        user = User(provider_subject="dev:rating-owner")
        friend = User(provider_subject="dev:rating-friend")
        session.add_all([course, user, friend])
        session.flush()
        round_ = Round(user_id=user.id, course_id=course.id, played_on=date(2026, 7, 14), favorite_hole=7)
        session.add(round_)
        session.flush()
        session.add(UserCourseRating(user_id=user.id, course_id=course.id, round_id=round_.id, tier="green", rating=9.3, confidence=0.5))
        session.add_all([
            RoundCompanion(round_id=round_.id, friend_user_id=friend.id),
            RoundCompanion(round_id=round_.id, guest_name="Jordan Guest"),
        ])
        session.commit()

        assert session.scalar(select(UserCourseRating)).rating == 9.3
        assert [item.guest_name for item in session.scalars(select(RoundCompanion))] == [None, "Jordan Guest"]
        assert "phone" not in RoundCompanion.__table__.columns
```

- [ ] **Step 2: Run the model test and verify it fails**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest tests/test_models.py::test_rating_projection_and_round_companions -v`

Expected: FAIL because the new models and `favorite_hole` do not exist.

- [ ] **Step 3: Add the SQLAlchemy models**

Add `favorite_hole: Mapped[int | None]` to `Round`, plus these focused models:

```python
class UserCourseRating(Base):
    __tablename__ = "user_course_ratings"
    __table_args__ = (UniqueConstraint("user_id", "course_id", name="uq_user_course_rating_user_course"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id", ondelete="CASCADE"), unique=True)
    tier: Mapped[str] = mapped_column(String(20), index=True)
    rating: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RoundCompanion(Base):
    __tablename__ = "round_companions"
    __table_args__ = (
        CheckConstraint(
            "(friend_user_id IS NOT NULL AND guest_name IS NULL) OR "
            "(friend_user_id IS NULL AND guest_name IS NOT NULL)",
            name="ck_round_companion_exactly_one_identity",
        ),
        UniqueConstraint("round_id", "friend_user_id", name="uq_round_companion_friend"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id", ondelete="CASCADE"), index=True)
    friend_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    guest_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
```

Import `CheckConstraint` and add `favorite_hole = mapped_column(Integer, nullable=True)` to `Round`.

- [ ] **Step 4: Create migration `0005_rating_experience`**

The upgrade must add `rounds.favorite_hole`, create both tables and indexes, and rename existing assignment rows:

```python
op.add_column("rounds", sa.Column("favorite_hole", sa.Integer(), nullable=True))
op.execute("UPDATE tier_assignments SET tier = CASE tier WHEN 'loved_it' THEN 'green' WHEN 'liked_it' THEN 'fairway' WHEN 'fine' THEN 'rough' WHEN 'no' THEN 'bunker' ELSE tier END")
```

The downgrade reverses the four tier values before dropping `round_companions`, `user_course_ratings`, and `favorite_hole` in dependency-safe order.

- [ ] **Step 5: Run the model and migration tests**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest tests/test_models.py -v`

Expected: PASS.

- [ ] **Step 6: Commit the persistence layer**

```bash
git add services/api/app/models.py services/api/alembic/versions/0005_rating_experience.py services/api/tests/test_models.py
git commit -m "feat: persist current course ratings"
```

### Task 2: Make the ranking engine transaction-safe and golf-themed

**Files:**
- Modify: `services/api/app/schemas.py`
- Modify: `services/api/app/ranking.py`
- Modify: `services/api/tests/test_rankings.py`

- [ ] **Step 1: Change ranking tests to the public golf tiers**

Replace placement values with `green`, `fairway`, `rough`, and `bunker`; preserve the band assertion:

```python
response = client.put(
    "/api/v1/me/rankings/tiers",
    headers=HEADERS,
    json={"assignments": [
        {"course_id": 1, "tier": "green", "position": 1},
        {"course_id": 2, "tier": "green", "position": 2},
        {"course_id": 3, "tier": "fairway", "position": 1},
    ]},
)
assert [entry["personal_rating"] for entry in response.json()["entries"]] == [10.0, 8.5, 7.7]
assert [entry["tier"] for entry in response.json()["entries"]] == ["green", "green", "fairway"]
```

- [ ] **Step 2: Run ranking tests and verify they fail**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest tests/test_rankings.py -v`

Expected: FAIL with tier validation errors.

- [ ] **Step 3: Rename schemas and engine constants**

Use:

```python
RankingTier = Literal["green", "fairway", "rough", "bunker"]
PlacementTier = Literal["green", "fairway", "rough", "bunker", "not_sure"]

TIER_ORDER = ("green", "fairway", "rough", "bunker", "not_sure")
TIER_BANDS = {
    "green": (8.5, 10.0),
    "fairway": (7.0, 8.4),
    "rough": (5.0, 6.9),
    "bunker": (1.0, 4.9),
}
ALGORITHM_VERSION = "golf-tier-linear-v2"
```

Add a legacy snapshot adapter that maps old JSON tier strings before `RankingSnapshotOut` validation:

```python
LEGACY_TIERS = {"loved_it": "green", "liked_it": "fairway", "fine": "rough", "no": "bunker"}

def _public_entries(entries: list[dict]) -> list[dict]:
    return [{**entry, "tier": LEGACY_TIERS.get(entry["tier"], entry["tier"])} for entry in entries]
```

- [ ] **Step 4: Remove the commit from `_build_snapshot`**

Rename it `_stage_snapshot`, call `session.flush()` instead of `session.commit()`, and have each existing route commit after it receives the output. This lets the course-rating route stage a snapshot inside its larger transaction.

- [ ] **Step 5: Run ranking tests**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest tests/test_rankings.py -v`

Expected: PASS with the same numeric ratings under new tier names.

- [ ] **Step 6: Commit the ranking refactor**

```bash
git add services/api/app/schemas.py services/api/app/ranking.py services/api/tests/test_rankings.py
git commit -m "feat: rename ranking tiers for golf"
```

### Task 3: Add the transactional course-rating API

**Files:**
- Create: `services/api/app/course_ratings.py`
- Modify: `services/api/app/main.py`
- Modify: `services/api/app/schemas.py`
- Create: `services/api/tests/test_course_ratings.py`

- [ ] **Step 1: Write failing API tests**

Cover state, candidate lookup, core save, aggregation, update replacement, privacy, and details. The core assertion is:

```python
def test_course_rating_creates_one_round_and_current_projection() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/course-ratings/1",
        headers=HEADERS,
        json={"tier": "green", "played_on": "2026-07-14", "score": 82},
    )
    assert response.status_code == 200
    assert response.json()["personal_rating"] == 9.2
    assert response.json()["tier"] == "green"
    assert response.json()["round"]["score"] == 82
    assert response.json()["community_rating"] == 9.2
    assert response.json()["rating_count"] == 1

    second = client.put(
        "/api/v1/me/course-ratings/1",
        headers=HEADERS,
        json={"tier": "fairway", "played_on": "2026-07-13", "score": None},
    )
    assert second.json()["rating_count"] == 1
    assert second.json()["round"]["score"] is None
```

Also assert a forced snapshot failure leaves no `Round`, `TierAssignment`, or `UserCourseRating`, and assert a different user cannot read notes or companions.

- [ ] **Step 2: Run the new API tests and verify 404 failures**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest tests/test_course_ratings.py -v`

Expected: FAIL because the router is not registered.

- [ ] **Step 3: Define request and response schemas**

Use validated models with private defaults:

```python
class CourseRatingIn(BaseModel):
    tier: RankingTier
    played_on: date
    score: int | None = Field(default=None, ge=40, le=250)
    comparison_course_id: int | None = Field(default=None, gt=0)
    comparison_result: ComparisonResult | None = None

class RatingDetailsPatch(BaseModel):
    note: str | None = Field(default=None, max_length=5000)
    favorite_hole: int | None = Field(default=None, ge=1, le=18)
    friend_user_ids: list[int] = Field(default_factory=list, max_length=40)
    guest_names: list[str] = Field(default_factory=list, max_length=20)
    visibility: Literal["private", "friends"] = "private"
```

Reject future play dates and require `comparison_course_id` and `comparison_result` together.

- [ ] **Step 4: Implement candidate and aggregate helpers**

Candidate selection excludes the course itself and orders peers by fewest comparisons, then tier position and ID. Aggregate only current projections:

```python
average, count = session.execute(
    select(func.avg(UserCourseRating.rating), func.count(UserCourseRating.id))
    .where(UserCourseRating.course_id == course_id)
).one()
return (round(float(average), 1) if average is not None else None, count)
```

- [ ] **Step 5: Implement atomic `PUT /api/v1/me/course-ratings/{course_id}`**

Create or update the tier assignment and its position, validate/stage the comparison when supplied, create or update the rating-owned round, call `_stage_snapshot`, copy this course's derived rating/confidence into `UserCourseRating`, refresh `UserCourseState`, then commit once. Roll back and re-raise on any exception.

- [ ] **Step 6: Implement state and details endpoints**

Add:

```text
GET   /api/v1/me/course-ratings/{course_id}
GET   /api/v1/me/course-ratings/{course_id}/comparison-candidate?tier=green
PATCH /api/v1/me/course-ratings/{course_id}/details
```

The details patch replaces companions, validates that friend IDs are in the current user's follow list, stores guest display names only, updates the round event visibility, and never returns another user's private details.

- [ ] **Step 7: Register the router and expose aggregate course fields**

Include `course_ratings.router` in `main.py`. Extend `CourseOut` with `community_rating: float | None = None` and `rating_count: int = 0`, and populate them in course list/detail responses with a grouped aggregate query to avoid per-course queries.

- [ ] **Step 8: Run focused API tests**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest tests/test_course_ratings.py tests/test_rankings.py tests/test_rounds.py tests/test_social.py -v`

Expected: PASS.

- [ ] **Step 9: Commit the rating API**

```bash
git add services/api/app/course_ratings.py services/api/app/main.py services/api/app/schemas.py services/api/tests/test_course_ratings.py
git commit -m "feat: add course rating API"
```

### Task 4: Add typed mobile API support

**Files:**
- Modify: `apps/frontend/src/types.ts`
- Modify: `apps/frontend/src/api/client.ts`
- Modify: `apps/frontend/src/api/__tests__/client.test.ts`

- [ ] **Step 1: Write failing client tests**

```typescript
it('loads, saves, and patches a course rating with auth', async () => {
  const headers = { 'Content-Type': 'application/json' as const, Authorization: 'Bearer test.jwt' }
  await getCourseRating(1, headers)
  await getRatingCandidate(1, 'green', headers)
  await saveCourseRating(1, { tier: 'green', played_on: '2026-07-14', score: 82 }, headers)
  await saveRatingDetails(1, { note: 'Fast greens', favorite_hole: 7, friend_user_ids: [], guest_names: [], visibility: 'private' }, headers)
  expect(fetchMock).toHaveBeenCalledTimes(4)
})
```

- [ ] **Step 2: Run the client test and verify missing exports**

Run: `cd apps/frontend && npm test -- --runInBand src/api/__tests__/client.test.ts`

Expected: FAIL because the four client functions do not exist.

- [ ] **Step 3: Add exact frontend types**

Define the shared contract and extend `Course` with nullable `community_rating` and numeric `rating_count`:

```typescript
export type RatingTier = 'green' | 'fairway' | 'rough' | 'bunker'

export type CourseRatingInput = {
  tier: RatingTier
  played_on: string
  score: number | null
  comparison_course_id?: number
  comparison_result?: ComparisonResult
}

export type RatingDetailsInput = {
  note: string | null
  favorite_hole: number | null
  friend_user_ids: number[]
  guest_names: string[]
  visibility: 'private' | 'friends'
}

export type CourseRatingState = {
  course: Course
  personal_rating: number | null
  tier: RatingTier | null
  confidence: number | null
  community_rating: number | null
  rating_count: number
  round: { id: number; played_on: string; score: number | null; note: string | null; favorite_hole: number | null; visibility: 'private' | 'friends' } | null
  companions: { friend_user_id: number | null; guest_name: string | null }[]
}

export type RatingCandidate = { course: Course } | null
export type FriendSummary = { id: number; display_name: string; username: string | null }
```

- [ ] **Step 4: Add authenticated client methods**

Implement the four methods above plus `getFriends(headers)` using `/api/v1/me/follows`. Every mutation uses `responseError`, JSON bodies, and the supplied auth headers.

- [ ] **Step 5: Run client tests and TypeScript**

Run: `cd apps/frontend && npm test -- --runInBand src/api/__tests__/client.test.ts`

Expected: PASS.

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit typed API support**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/api/client.ts apps/frontend/src/api/__tests__/client.test.ts
git commit -m "feat: add mobile rating API client"
```

### Task 5: Build the guided rating flow

**Files:**
- Create: `apps/frontend/src/components/RatingFlow.tsx`
- Create: `apps/frontend/src/components/__tests__/RatingFlow.test.tsx`
- Create: `apps/frontend/app/rate/[id].tsx`
- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/package-lock.json`
- Modify: `apps/frontend/app.json`

- [ ] **Step 1: Install native capabilities with Expo-compatible versions**

Run: `cd apps/frontend && npx expo install expo-contacts expo-sms`

Expected: Expo installs SDK-compatible versions and updates the lockfile. Add the `expo-contacts` config plugin with a clear contacts permission string in `app.json`; SMS uses the system composer and needs no silent-send capability.

- [ ] **Step 2: Write the failing flow tests**

Test the public component contract with injected callbacks:

```typescript
render(<RatingFlow
  course={course}
  initialState={null}
  friends={friends}
  getCandidate={getCandidate}
  saveRating={saveRating}
  saveDetails={saveDetails}
  pickGuest={pickGuest}
  composeSms={composeSms}
  onDone={onDone}
/>)
fireEvent.press(screen.getByRole('button', { name: 'Green A personal favorite' }))
fireEvent.changeText(screen.getByLabelText('Golf score, optional'), '82')
fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
fireEvent.press(screen.getByRole('button', { name: /Choose Pebble Beach/ }))
await waitFor(() => expect(screen.getByText('9.3 / 10')).toBeOnTheScreen())
```

Add tests for no step counter, Skip, retained values after save failure, prefilled edit state, unchanged-tier detail edits, photo coming-soon messaging, friend selection, contact permission denial, and explicit Send invite before `composeSms`.

- [ ] **Step 3: Run the flow tests and verify the component is missing**

Run: `cd apps/frontend && npm test -- --runInBand src/components/__tests__/RatingFlow.test.tsx`

Expected: FAIL because `RatingFlow` does not exist.

- [ ] **Step 4: Implement a reducer-driven `RatingFlow`**

Use explicit states `tier`, `round`, `compare`, `reveal`, and `details` without displaying their index. Keep data in one reducer so Back and retry never discard inputs. Render one focused question per state, use `KeyboardAvoidingView`, accessible labels, and existing theme tokens.

Tier buttons must pair the golf name and description. The compare state offers both courses, Too close, and Not sure. The reveal saves the core rating before showing the derived number. Details contain note, favorite-hole selector, disabled/coming-soon photo affordance, friend chips, Add guest, and private/share-with-friends choice.

- [ ] **Step 5: Implement contact and SMS adapters in the route**

The route loads course, rating state, and friends with auth. Its guest adapter requests contacts only after Add guest, opens the native contact picker, keeps the phone number only in component memory, and presents Send invite before calling:

```typescript
await SMS.sendSMSAsync([guest.phoneNumber], `I rated ${course.name} on GolfRank—join me on the app.`)
```

Never send from an effect and never include the number in `saveRatingDetails`.

- [ ] **Step 6: Run flow tests and TypeScript**

Run: `cd apps/frontend && npm test -- --runInBand src/components/__tests__/RatingFlow.test.tsx`

Expected: PASS.

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the guided flow**

```bash
git add apps/frontend/src/components/RatingFlow.tsx apps/frontend/src/components/__tests__/RatingFlow.test.tsx apps/frontend/app/rate apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/app.json
git commit -m "feat: build guided course rating flow"
```

### Task 6: Wire Rate and Rated on course pages

**Files:**
- Modify: `apps/frontend/app/course/[id].tsx`
- Create: `apps/frontend/app/__tests__/course-detail.test.tsx`

- [ ] **Step 1: Write failing course-page tests**

Mock course and rating calls. Assert an unrated response renders a functional Rate action that pushes `/rate/1`, while a personal rating renders `9.3 / 10`, check-circle Rated, and the same edit route. Assert Played and Review are absent and the `72.4` fact says Course rating.

- [ ] **Step 2: Run the course test and verify failure**

Run: `cd apps/frontend && npm test -- --runInBand app/__tests__/course-detail.test.tsx`

Expected: FAIL because actions lack handlers and rating state is not loaded.

- [ ] **Step 3: Load authenticated rating state**

Resolve the API course ID, call `getCourseRating`, and keep loading/error/rated states separate. For API-backed and seeded demo courses, navigate with the numeric ID. Do not mark Rated optimistically.

- [ ] **Step 4: Simplify the course page**

Render community aggregate as `x.x / 10 · n ratings` or No ratings yet, render personal numeric rating without tier text, and replace the five actions with Rate/Rated, Save, and Share. Wire Rate/Rated to `/rate/{courseId}` and relabel the golf fact Course rating.

- [ ] **Step 5: Run course tests and TypeScript**

Run: `cd apps/frontend && npm test -- --runInBand app/__tests__/course-detail.test.tsx`

Expected: PASS.

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the course integration**

```bash
git add apps/frontend/app/course/[id].tsx apps/frontend/app/__tests__/course-detail.test.tsx
git commit -m "feat: wire course rating actions"
```

### Task 7: Remove five-star ratings everywhere

**Files:**
- Modify: `apps/frontend/src/data/demo.ts`
- Modify: `apps/frontend/src/components/ProductUI.tsx`
- Modify: `apps/frontend/src/components/GetStartedScreen.tsx`
- Modify: `apps/frontend/app/discover.tsx`
- Modify: `apps/frontend/app/home.tsx`
- Modify: `apps/frontend/app/profile.tsx`
- Modify: `apps/frontend/app/rankings.tsx`
- Modify: `apps/frontend/src/components/__tests__/components.test.tsx`

- [ ] **Step 1: Write a failing ten-point presentation test**

Render shared course cards/rows and assert `9.8 / 10`; assert no text matches five repeated stars and no visible rating begins with a star. Add focused assertions for the welcome artwork and tier label mapping.

- [ ] **Step 2: Run component tests and verify five-star failures**

Run: `cd apps/frontend && npm test -- --runInBand src/components/__tests__/components.test.tsx`

Expected: FAIL because shared components render `★ 4.x`.

- [ ] **Step 3: Convert demo and shared presentation**

Change demo community ratings to ten-point values with the exact mapping `4.9 -> 9.8`, `4.8 -> 9.6`, `4.7 -> 9.4`, and `4.6 -> 9.2`; rename the field to `communityRating`, and use a shared formatter:

```typescript
export function ratingLabel(value?: number | null): string {
  return value == null ? 'No ratings yet' : `${value.toFixed(1)} / 10`
}
```

Remove star glyphs from CourseCard and DemoCourseRow.

- [ ] **Step 4: Convert direct screen markup**

Use `ratingLabel` on home and discover. Replace the welcome `4.8` and five-star row with `9.6 / 10`. Show profile Top rating as `9.4 / 10`. Remove tier text from ranking cards and map any remaining editor labels to Green, Fairway, Rough, and Bunker.

- [ ] **Step 5: Run a repository rating scan**

Run: `rg -n "★★★★★|★ [0-5]\\.|rating: 4\\.|Stars\\(|Loved it|Liked it|It was fine" apps/frontend --glob '!package-lock.json'`

Expected: no rating-presentation matches. Non-rating prose must be reviewed individually rather than removed blindly.

- [ ] **Step 6: Run frontend tests and TypeScript**

Run: `cd apps/frontend && npm test -- --runInBand`

Expected: PASS.

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the ten-point cleanup**

```bash
git add apps/frontend/src/data/demo.ts apps/frontend/src/components/ProductUI.tsx apps/frontend/src/components/GetStartedScreen.tsx apps/frontend/app/discover.tsx apps/frontend/app/home.tsx apps/frontend/app/profile.tsx apps/frontend/app/rankings.tsx apps/frontend/src/components/__tests__/components.test.tsx
git commit -m "feat: standardize ratings out of ten"
```

### Task 8: Verify the complete feature

**Files:**
- Modify: `packages/contracts/openapi.md`

- [ ] **Step 1: Document the final API contract**

Add the course-rating state, candidate, atomic PUT, details PATCH, community aggregate fields, privacy defaults, and golf-tier values to `packages/contracts/openapi.md` using concrete request/response JSON.

- [ ] **Step 2: Run the complete backend suite**

Run: `cd services/api && /opt/anaconda3/bin/python -m pytest -v`

Expected: PASS.

- [ ] **Step 3: Run the complete frontend suite**

Run: `cd apps/frontend && npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 4: Run static and migration checks**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: PASS.

Run: `docker compose run --rm api alembic upgrade head`

Expected: migration reaches `0005_rating_experience` successfully.

- [ ] **Step 5: Run cleanliness scans**

Run: `git diff --check`

Expected: no output.

Run: `rg -n "★★★★★|★ [0-5]\\.|rating: 4\\.|Loved it|Liked it|It was fine" apps/frontend --glob '!package-lock.json'`

Expected: no rating-presentation matches.

- [ ] **Step 6: Perform device-level manual checks**

Verify on iOS Simulator: unrated Rate, Green/Fairway/Rough/Bunker choices, optional score/date, comparison, result reveal, Rated edit state, notes, favorite hole, friend selection, contact denial, contact selection, editable SMS and cancellation, private/share choice, photo coming-soon state, retry after forced network failure, small-screen keyboard behavior, and accessible labels.

- [ ] **Step 7: Commit docs and final fixes**

```bash
git add packages/contracts/openapi.md
git commit -m "docs: document course rating API"
```
