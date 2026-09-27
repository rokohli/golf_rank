from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.course_reports import get_course_golfer_reports
from app.domain import require_course
from app.main import create_app
from app.models import Course, CourseReconciliation, Round, User


USER1 = {"X-Development-Subject": "dev:report-user1"}
USER2 = {"X-Development-Subject": "dev:report-user2"}
USER3 = {"X-Development-Subject": "dev:report-user3"}
USER4 = {"X-Development-Subject": "dev:report-user4"}


def _log_round(
    client: TestClient,
    headers: dict[str, str],
    course_id: int,
    played_on: str,
    tags: list[str],
    visibility: str = "public",
) -> int:
    res = client.post(
        "/api/v1/me/rounds",
        headers=headers,
        json={
            "course_id": course_id,
            "played_on": played_on,
            "tags": tags,
            "visibility": visibility,
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_golfer_reports_suppressed_below_minimum_threshold() -> None:
    app = create_app()
    client = TestClient(app)

    # Only 2 distinct golfers log rounds with tags
    _log_round(client, USER1, 1, "2026-07-01", ["walked", "ocean_views"])
    _log_round(client, USER2, 1, "2026-07-02", ["walked", "ocean_views"])

    with app.state.session_factory() as session:
        course = require_course(session, 1)
        reports = get_course_golfer_reports(session, course)
        assert reports is None

    # Endpoint returns None / null
    res = client.get("/api/v1/courses/1")
    assert res.status_code == 200
    assert res.json()["golfer_reports"] is None

    res_reports = client.get("/api/v1/courses/1/golfer-reports")
    assert res_reports.status_code == 200
    assert res_reports.json() is None


def test_golfer_reports_reconciliation_locomotion_and_highlights() -> None:
    app = create_app()
    client = TestClient(app)

    # Set up course alias reconciliation between course 1 and 2
    with app.state.session_factory() as session:
        c1 = require_course(session, 1)
        c2 = require_course(session, 2)
        session.add(
            CourseReconciliation(
                canonical_course_id=c1.id,
                source=c2.source,
                source_course_id=c2.source_course_id,
                match_status="confirmed",
            )
        )
        session.commit()

    # User 1 logs on canonical course 1: walked, ocean_views, fast_greens
    _log_round(client, USER1, 1, "2026-07-01", ["walked", "ocean_views", "fast_greens"])
    # User 2 logs on alias course 2: walked, ocean_views, fast_greens
    _log_round(client, USER2, 2, "2026-07-02", ["walked", "ocean_views", "fast_greens"])
    # User 3 logs on canonical course 1: cart, ocean_views
    _log_round(client, USER3, 1, "2026-07-03", ["cart", "ocean_views"])
    # User 4 logs on alias course 2: walked, scenic_views (scenic_views has count=1, below threshold)
    _log_round(client, USER4, 2, "2026-07-04", ["walked", "scenic_views"])

    res = client.get("/api/v1/courses/1")
    assert res.status_code == 200
    reports = res.json()["golfer_reports"]
    assert reports is not None

    # 4 distinct eligible reporting golfers
    assert reports["total_reporting_golfers"] == 4

    # Locomotion: 3 walked, 1 cart = 4 total reporters (75% walked)
    locomotion = reports["locomotion"]
    assert locomotion is not None
    assert locomotion["walk_count"] == 3
    assert locomotion["cart_count"] == 1
    assert locomotion["total_reporters"] == 4
    assert locomotion["walk_percentage"] == 75
    assert locomotion["label"] == "3 of 4 reporting golfers walked"

    # Highlights:
    # ocean_views: reported by User1, User2, User3 (count=3) -> published
    # fast_greens: reported by User1, User2 (count=2) -> suppressed
    # scenic_views: reported by User4 (count=1) -> suppressed
    highlights = reports["highlights"]
    assert len(highlights) == 1
    assert highlights[0]["tag"] == "ocean_views"
    assert highlights[0]["label"] == "Ocean Views"
    assert highlights[0]["count"] == 3

    # Calling alias course 2 also resolves the same reconciled reports
    res_alias = client.get("/api/v1/courses/2")
    assert res_alias.status_code == 200
    assert res_alias.json()["golfer_reports"]["total_reporting_golfers"] == 4


def test_latest_round_rule_before_eligibility_filtering() -> None:
    app = create_app()
    client = TestClient(app)

    # 3 initial valid public rounds
    _log_round(client, USER1, 1, "2026-07-01", ["walked", "fast_greens"])
    _log_round(client, USER2, 1, "2026-07-02", ["walked", "fast_greens"])
    _log_round(client, USER3, 1, "2026-07-03", ["walked", "fast_greens"])

    res = client.get("/api/v1/courses/1")
    assert res.json()["golfer_reports"] is not None

    # USER3 now logs a NEWER round that is private!
    _log_round(client, USER3, 1, "2026-07-10", ["cart"], visibility="private")

    # The latest round for USER3 is private, so USER3 now contributes 0 reports.
    # Total eligible reporting golfers drops to 2 (below threshold 3), so reports are suppressed!
    res_after_private = client.get("/api/v1/courses/1")
    assert res_after_private.json()["golfer_reports"] is None

    # USER3 now logs another NEWER public round but with empty tags (no tags)
    _log_round(client, USER3, 1, "2026-07-15", [], visibility="public")

    # Latest round for USER3 has no tags, so still 0 contribution (never falls back to older rounds)
    res_after_empty = client.get("/api/v1/courses/1")
    assert res_after_empty.json()["golfer_reports"] is None


def test_recency_window_expires_old_reports() -> None:
    app = create_app()
    client = TestClient(app)

    # 3 golfers log public rounds
    _log_round(client, USER1, 1, "2024-01-01", ["walked", "fast_greens"])  # > 2 years ago relative to 2026-07-01
    _log_round(client, USER2, 1, "2026-06-01", ["walked", "fast_greens"])
    _log_round(client, USER3, 1, "2026-06-15", ["walked", "fast_greens"])

    with app.state.session_factory() as session:
        course = require_course(session, 1)
        # Evaluate as of 2026-07-01 (USER1's round is from Jan 2024, > 730 days ago)
        reports = get_course_golfer_reports(session, course, as_of=date(2026, 7, 1))
        # Only 2 golfers within 24 months -> suppressed!
        assert reports is None
