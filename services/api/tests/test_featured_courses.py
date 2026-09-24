import concurrent.futures
import json
import threading
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.featured_courses import budget_tracker, current_week_anchor, monthly_ai_cost_micros
from app.main import create_app
from app.models import (
    Course,
    DailyFeaturedCourse,
    Round,
    SavedCourse,
    SavedList,
    User,
    UserCourseRating,
    UserCourseState,
)


ALICE = {"X-Development-Subject": "dev:featured-alice"}
BOB = {"X-Development-Subject": "dev:featured-bob"}


def _setup_alice_preferences(client: TestClient, max_green_fee: int = 700, access: str = "public", difficulty: str = "challenging") -> None:
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers=ALICE,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": max_green_fee,
            "difficulty": difficulty,
            "access": access,
            "onboarding_data": {
                "first_name": "Alice",
                "last_name": "Golfer",
                "username": "alice",
                "travel_distance": "Up to 45 minutes",
                "transportation": "Walking",
                "group_size": "Foursome",
                "played_course_ids": [],
                "dream_course_ids": [],
            },
        },
    )


def test_lazy_generation_and_caching() -> None:
    app = create_app()
    client = TestClient(app)
    _setup_alice_preferences(client)

    # 1. First GET creates recommendation lazily
    res1 = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["sequence"] == 1
    assert data1["can_dismiss"] is True
    assert data1["recommendation_date"] == current_week_anchor().isoformat()
    assert data1["is_saved"] is False
    assert data1["course"]["id"] in {1, 2, 3}  # One of the seed courses
    assert len(data1["match_tags"]) >= 1
    assert data1["headline"]
    assert data1["rationale"]

    # 2. Second GET returns identical cached row without creating a new sequence or row
    res2 = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["id"] == data1["id"]
    assert data2["course"]["id"] == data1["course"]["id"]
    assert data2["sequence"] == 1


def test_budget_and_access_filtering() -> None:
    app = create_app()
    client = TestClient(app)

    # In seed data:
    # Course 1: Pebble Beach (fee: 675)
    # Course 2: Spyglass Hill (fee: 495)
    # Course 3: Pasatiempo (fee: 410)
    # If max_green_fee is 450, only Course 3 (Pasatiempo) can match!
    _setup_alice_preferences(client, max_green_fee=450)

    res = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res.status_code == 200
    assert res.json()["course"]["id"] == 3
    assert res.json()["course"]["green_fee"] == 410


def test_excludes_already_played_courses() -> None:
    app = create_app()
    client = TestClient(app)
    _setup_alice_preferences(client, max_green_fee=500)
    # Spyglass (2, $495) and Pasatiempo (3, $410) qualify.

    # Mark Course 3 (Pasatiempo) as played via a logged round
    client.post(
        "/api/v1/me/rounds",
        headers=ALICE,
        json={
            "course_id": 3,
            "played_on": date.today().isoformat(),
            "score": 78,
            "tier": "fairway",
        },
    )

    res = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res.status_code == 200
    # Must NOT be course 3 since it was played!
    assert res.json()["course"]["id"] == 2


def test_live_distance_currency_on_read() -> None:
    app = create_app()
    client = TestClient(app)
    _setup_alice_preferences(client)

    # Get cached without coords
    res1 = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res1.status_code == 200
    course_id = res1.json()["course"]["id"]

    # Pebble Beach coords: 36.568, -121.949
    res2 = client.get("/api/v1/me/featured-course?lat=36.568&lng=-121.949", headers=ALICE)
    assert res2.status_code == 200
    assert res2.json()["course"]["id"] == course_id
    assert res2.json()["distance_miles"] is not None
    # Distance from Pebble to Pebble is ~0 miles
    if course_id == 1:
        assert res2.json()["distance_miles"] < 1.0


def test_dismiss_sequence_and_daily_cap() -> None:
    app = create_app()
    client = TestClient(app)
    _setup_alice_preferences(client)

    # Initial recommendation: sequence 1
    r1 = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert r1.status_code == 200
    assert r1.json()["sequence"] == 1
    first_course_id = r1.json()["course"]["id"]

    # Dismiss 1 -> Sequence 2
    d1 = client.post("/api/v1/me/featured-course/dismiss", headers=ALICE)
    assert d1.status_code == 200
    assert d1.json()["sequence"] == 2
    assert d1.json()["course"]["id"] != first_course_id
    assert d1.json()["can_dismiss"] is True

    # Dismiss 2 -> Sequence 3
    d2 = client.post("/api/v1/me/featured-course/dismiss", headers=ALICE)
    assert d2.status_code == 200
    assert d2.json()["sequence"] == 3
    assert d2.json()["can_dismiss"] is True

    # Dismiss 3 -> Sequence 4 (Last allowed refresh)
    d3 = client.post("/api/v1/me/featured-course/dismiss", headers=ALICE)
    assert d3.status_code == 200
    assert d3.json()["sequence"] == 4
    assert d3.json()["can_dismiss"] is False

    # Dismiss 4 -> Exceeds cap (max 3 dismissals per day) -> HTTP 400
    d4 = client.post("/api/v1/me/featured-course/dismiss", headers=ALICE)
    assert d4.status_code == 400
    assert "limit reached" in d4.json()["detail"].lower()


def test_dismiss_returns_404_when_no_active_recommendation() -> None:
    app = create_app()
    client = TestClient(app)
    # Bob hasn't generated a featured course yet
    res = client.post("/api/v1/me/featured-course/dismiss", headers=BOB)
    assert res.status_code == 404


def test_1_tap_save_to_default_list() -> None:
    app = create_app()
    client = TestClient(app)
    _setup_alice_preferences(client)

    # Get today's featured course
    res = client.get("/api/v1/me/featured-course", headers=ALICE)
    course_id = res.json()["course"]["id"]
    assert res.json()["is_saved"] is False

    # Save it
    save_res = client.post("/api/v1/me/featured-course/save", headers=ALICE)
    assert save_res.status_code == 200
    assert save_res.json()["status"] == "saved"
    assert save_res.json()["course_id"] == course_id

    # Next GET shows is_saved = True
    res_after = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res_after.status_code == 200
    assert res_after.json()["is_saved"] is True


def test_gemini_ai_narrative_and_timeout_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "mock-gemini-key"
        return httpx.Response(200, json={
            "candidates": [{
                "finishReason": "STOP",
                "content": {"parts": [{
                    "text": json.dumps({
                        "headline": "AI Recommended Match",
                        "rationale": "Grounded AI rationale based on verified course facts.",
                        "match_tags": ["Challenging", "Public", "Great Walk"],
                    }),
                }]},
            }],
            "usageMetadata": {
                "promptTokenCount": 90,
                "candidatesTokenCount": 30,
                "thoughtsTokenCount": 0,
            },
        })

    monkeypatch.setattr(
        "app.featured_courses.httpx.AsyncClient",
        lambda **kwargs: original_async_client(
            **kwargs, transport=httpx.MockTransport(handler)
        ),
    )

    app = create_app(Settings(
        ai_planner_enabled=True,
        gemini_api_key="mock-gemini-key",
    ))
    client = TestClient(app)
    _setup_alice_preferences(client)

    # Success path: Gemini returns structured output
    res = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res.status_code == 200
    assert res.json()["headline"] == "AI Recommended Match"
    assert res.json()["rationale"] == "Grounded AI rationale based on verified course facts."
    assert "Challenging" in res.json()["match_tags"]

    # Test timeout path: Gemini times out -> falls back cleanly to template without crashing
    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    monkeypatch.setattr(
        "app.featured_courses.httpx.AsyncClient",
        lambda **kwargs: original_async_client(
            **kwargs, transport=httpx.MockTransport(timeout_handler)
        ),
    )

    # Bob's request triggers the timeout handler
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers=BOB,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 700,
            "difficulty": "challenging",
            "access": "public",
        },
    )
    res_bob = client.get("/api/v1/me/featured-course", headers=BOB)
    assert res_bob.status_code == 200
    assert res_bob.json()["headline"] in {"This Week's Course Spotlight", "Regional Course Spotlight", "From Your Saved List"}
    assert "Monterey" in res_bob.json()["rationale"]


def test_ai_monthly_cost_limit_enforcement(monkeypatch: pytest.MonkeyPatch) -> None:
    # Set limit to 1 cent (10,000 micro-dollars)
    app = create_app(Settings(
        ai_planner_enabled=True,
        gemini_api_key="mock-gemini-key",
        ai_featured_course_monthly_cost_limit_cents=1,
    ))
    client = TestClient(app)
    _setup_alice_preferences(client)

    # Seed an existing recommendation that spent 20,000 micro-dollars (exceeding 10,000 limit)
    factory = app.state.session_factory
    with factory() as session:
        user = session.scalar(select(User).where(User.provider_subject == "dev:featured-alice"))
        spent_row = DailyFeaturedCourse(
            user_id=user.id,
            course_id=1,
            recommendation_date=current_week_anchor() - timedelta(days=7),
            sequence=1,
            dismissed=True,
            headline="Past row",
            rationale="Past rationale",
            match_tags=["tag"],
            generation_status="ai_generated",
            estimated_cost_micros=20_000,
            created_at=datetime.now(UTC),
        )
        session.add(spent_row)
        session.commit()

    # Even though AI is enabled and key is set, budget exhaustion causes fallback_template
    res = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res.status_code == 200
    assert res.json()["headline"] in {"This Week's Course Spotlight", "Regional Course Spotlight", "From Your Saved List"}


def test_partial_unique_index_prevents_duplicate_active_rows() -> None:
    app = create_app()
    factory = app.state.session_factory
    with factory() as session:
        user = User(provider_subject="dev:race-user")
        session.add(user)
        session.commit()

        r1 = DailyFeaturedCourse(
            user_id=user.id,
            course_id=1,
            recommendation_date=current_week_anchor(),
            sequence=1,
            dismissed=False,
            headline="Active 1",
            rationale="Rationale 1",
            match_tags=["tag"],
        )
        session.add(r1)
        session.commit()

        r2 = DailyFeaturedCourse(
            user_id=user.id,
            course_id=2,
            recommendation_date=current_week_anchor(),
            sequence=2,
            dismissed=False,
            headline="Active 2",
            rationale="Rationale 2",
            match_tags=["tag"],
        )
        session.add(r2)
        with pytest.raises(Exception) as exc_info:
            session.commit()
        assert "UNIQUE" in str(exc_info.value).upper() or "INTEGRITY" in str(exc_info.value).upper()


def test_multiple_dismissed_rows_allowed_on_same_date() -> None:
    app = create_app()
    factory = app.state.session_factory
    with factory() as session:
        user = User(provider_subject="dev:dismiss-user")
        session.add(user)
        session.commit()

        r1 = DailyFeaturedCourse(
            user_id=user.id,
            course_id=1,
            recommendation_date=current_week_anchor(),
            sequence=1,
            dismissed=True,
            headline="Dismissed 1",
            rationale="Rationale 1",
            match_tags=["tag"],
        )
        r2 = DailyFeaturedCourse(
            user_id=user.id,
            course_id=2,
            recommendation_date=current_week_anchor(),
            sequence=2,
            dismissed=True,
            headline="Dismissed 2",
            rationale="Rationale 2",
            match_tags=["tag"],
        )
        session.add_all([r1, r2])
        session.commit()


def test_ai_budget_boundary_enforcement(monkeypatch: pytest.MonkeyPatch) -> None:
    # 1 cent limit = 10,000 micros. Worst-case cost floor is 2,500 micros.
    settings = Settings(
        ai_planner_enabled=True,
        gemini_api_key="mock-gemini-key",
        ai_featured_course_monthly_cost_limit_cents=1,
    )
    app = create_app(settings)
    client = TestClient(app)
    _setup_alice_preferences(client)
    budget_tracker.reset()

    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "candidates": [{
                "finishReason": "STOP",
                "content": {"parts": [{
                    "text": json.dumps({
                        "headline": "AI Generated Headline",
                        "rationale": "AI Generated rationale.",
                        "match_tags": ["AI Pick"],
                    }),
                }]},
            }],
            "usageMetadata": {
                "promptTokenCount": 100,
                "candidatesTokenCount": 30,
                "thoughtsTokenCount": 0,
            },
        })

    monkeypatch.setattr(
        "app.featured_courses.httpx.AsyncClient",
        lambda **kwargs: original_async_client(
            **kwargs, transport=httpx.MockTransport(handler)
        ),
    )

    factory = app.state.session_factory

    # Seed existing spend at 8,000 micros ($0.0080).
    # Remaining headroom is 2,000 micros, which is below the 2,500 micros worst-case floor.
    # The admission check must refuse AI and use fallback template to guarantee spend does not exceed 10,000 micros.
    with factory() as session:
        user = session.scalar(select(User).where(User.provider_subject == "dev:featured-alice"))
        spent_row = DailyFeaturedCourse(
            user_id=user.id,
            course_id=1,
            recommendation_date=current_week_anchor() - timedelta(days=7),
            sequence=1,
            dismissed=True,
            headline="Past row",
            rationale="Past rationale",
            match_tags=["tag"],
            generation_status="ai_generated",
            estimated_cost_micros=8_000,
            created_at=datetime.now(UTC),
        )
        session.add(spent_row)
        session.commit()

    res = client.get("/api/v1/me/featured-course", headers=ALICE)
    assert res.status_code == 200
    assert res.json()["headline"] != "AI Generated Headline"
    assert res.json()["headline"] in {"This Week's Course Spotlight", "Regional Course Spotlight", "From Your Saved List"}

    with factory() as session:
        active_row = session.scalar(
            select(DailyFeaturedCourse).where(
                DailyFeaturedCourse.recommendation_date == current_week_anchor(),
                DailyFeaturedCourse.user_id == user.id,
            )
        )
        assert active_row.generation_status == "fallback_template"
        assert active_row.estimated_cost_micros in (0, None)
        total_cost = monthly_ai_cost_micros(session, DailyFeaturedCourse, DailyFeaturedCourse.estimated_cost_micros)
        assert total_cost == 8_000
        assert total_cost <= 10_000


def test_ai_budget_concurrency_race_prevention(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Set monthly limit to 1 cent (10,000 micros).
    # Worst case floor per request is 2,500 micros.
    db_path = tmp_path / "budget_race.db"
    settings = Settings(
        database_url=f"sqlite+pysqlite:///{db_path}",
        ai_planner_enabled=True,
        gemini_api_key="mock-gemini-key",
        ai_featured_course_monthly_cost_limit_cents=1,
    )
    app = create_app(settings)
    client = TestClient(app)
    factory = app.state.session_factory
    budget_tracker.reset()

    # Seed courses in file-backed database
    with factory() as session:
        for cid, name in [(1, "Pebble Beach"), (2, "Spyglass Hill"), (3, "Pasatiempo")]:
            if not session.get(Course, cid):
                session.add(Course(
                    id=cid,
                    name=name,
                    region="Monterey, CA",
                    latitude=36.5,
                    longitude=-121.9,
                    is_public=True,
                    difficulty="challenging",
                    green_fee=500,
                    source="seed",
                    source_course_id=f"course_{cid}",
                    access="public",
                ))
        session.commit()

    # Create 4 distinct users
    user_headers = [{"X-Development-Subject": f"dev:race-user-{i}"} for i in range(1, 5)]
    for h in user_headers:
        client.put(
            "/api/v1/me/onboarding-preferences",
            headers=h,
            json={
                "home_region": "Monterey, CA",
                "max_green_fee": 700,
                "difficulty": "challenging",
                "access": "public",
            },
        )

    # Seed spend at 5,000 micros.
    # Remaining headroom is 5,000 micros.
    # Since each reservation requires 2,500 micros, exactly 2 requests can be admitted concurrently.
    # The other 2 requests MUST be refused AI and fall back to deterministic template,
    # even when all 4 requests hit the endpoint at the exact same moment.
    with factory() as session:
        user1 = session.scalar(select(User).where(User.provider_subject == "dev:race-user-1"))
        spent_row = DailyFeaturedCourse(
            user_id=user1.id,
            course_id=1,
            recommendation_date=current_week_anchor() - timedelta(days=7),
            sequence=1,
            dismissed=True,
            headline="Past row",
            rationale="Past rationale",
            match_tags=["tag"],
            generation_status="ai_generated",
            estimated_cost_micros=5_000,
            created_at=datetime.now(UTC),
        )
        session.add(spent_row)
        session.commit()

    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        # Simulate network latency so that concurrent requests overlap in flight
        time.sleep(0.05)
        return httpx.Response(200, json={
            "candidates": [{
                "finishReason": "STOP",
                "content": {"parts": [{
                    "text": json.dumps({
                        "headline": "AI Concurrency Headline",
                        "rationale": "AI Concurrency rationale.",
                        "match_tags": ["AI Pick"],
                    }),
                }]},
            }],
            "usageMetadata": {
                "promptTokenCount": 100,
                "candidatesTokenCount": 30,
                "thoughtsTokenCount": 0,
            },
        })

    monkeypatch.setattr(
        "app.featured_courses.httpx.AsyncClient",
        lambda **kwargs: original_async_client(
            **kwargs, transport=httpx.MockTransport(handler)
        ),
    )

    barrier = threading.Barrier(4)

    def fetch_featured(h: dict[str, str]) -> httpx.Response:
        barrier.wait()
        return client.get("/api/v1/me/featured-course", headers=h)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(fetch_featured, user_headers))

    assert all(r.status_code == 200 for r in responses)

    # Verify how many were AI-generated vs fallback_template
    with factory() as session:
        current_rows = session.scalars(
            select(DailyFeaturedCourse).where(
                DailyFeaturedCourse.recommendation_date == current_week_anchor(),
            )
        ).all()
        ai_count = sum(1 for r in current_rows if r.generation_status == "ai_generated")
        fallback_count = sum(1 for r in current_rows if r.generation_status == "fallback_template")

        # Headroom was 5,000 micros. Each request requires 2,500 micros.
        # Exactly 2 requests could be admitted for AI. The other 2 fell back to template!
        assert ai_count == 2
        assert fallback_count == 2

        # Verify that total committed spend NEVER exceeds 10,000 micros
        total_spent = monthly_ai_cost_micros(session, DailyFeaturedCourse, DailyFeaturedCourse.estimated_cost_micros)
        assert total_spent <= 10_000

    # In-flight reservation must have cleanly returned to 0
    assert budget_tracker.in_flight_micros == 0


def test_statewide_fallback_deterministic_scoring_above_50_candidates() -> None:
    app = create_app()
    client = TestClient(app)
    factory = app.state.session_factory

    # Create 60 courses in Texas (TX)
    # Courses 101 through 159 have standard ratings / difficulty
    # Course 160 (beyond the old 50-item limit) has a 10.0 community rating,
    # making it undeniably the highest-scoring course in the state.
    with factory() as session:
        for i in range(1, 61):
            cid = 100 + i
            c = Course(
                id=cid,
                name=f"Texas Course {i}",
                city="Austin",
                region="Austin, TX",
                admin1_code="TX",
                status="active",
                is_public=True,
                green_fee=50,
                hole_count=18,
                par=72,
                difficulty="intermediate",
                latitude=30.0 + (i * 0.001),
                longitude=-97.0 - (i * 0.001),
            )
            session.add(c)
        session.commit()

        # Add 10.0 rating for Course 160 (far beyond the 50 limit)
        user_rater = User(provider_subject="dev:texan-rater")
        session.add(user_rater)
        session.commit()
        round_1 = Round(
            user_id=user_rater.id,
            course_id=160,
            played_on=date.today(),
            score=72,
        )
        session.add(round_1)
        session.commit()
        rating = UserCourseRating(
            user_id=user_rater.id,
            course_id=160,
            round_id=round_1.id,
            tier="green",
            rating=10.0,
            confidence=0.9,
        )
        session.add(rating)
        session.commit()

    # User in Texas with home_region Dallas (different city so local radius bbox finds nothing)
    TEXAN = {"X-Development-Subject": "dev:texan-user"}
    put_res = client.put(
        "/api/v1/me/onboarding-preferences",
        headers=TEXAN,
        json={
            "home_region": "Dallas, TX",
            "max_green_fee": 100,
            "difficulty": "intermediate",
            "access": "public",
            "onboarding_data": {
                "first_name": "Tex",
                "last_name": "Golfer",
                "username": "texan",
                "travel_distance": "Up to 15 minutes",
            },
        },
    )
    assert put_res.status_code == 200

    res = client.get("/api/v1/me/featured-course", headers=TEXAN)
    assert res.status_code == 200
    data = res.json()
    assert data["is_regional_fallback"] is True
    # In the old code, Course 160 was never in the candidate pool because .limit(50) cut off at 150.
    # Now all courses are evaluated, and Course 160 with highest rating wins!
    assert data["course"]["id"] == 160
    assert data["course"]["name"] == "Texas Course 60"


