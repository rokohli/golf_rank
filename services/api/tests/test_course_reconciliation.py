import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.course_reconciliation import confirm_mapping, normalized_name, propose_matches
from app.main import create_app
from app.models import Course, CourseReconciliation


def test_reconciliation_proposes_corroborated_pebble_match_not_name_only() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        session.add_all([
            Course(
                name="Pebble Beach Golf Links",
                region="Pebble Beach, CA",
                latitude=36.5681,
                longitude=-121.9491,
                source="opengolfapi",
                source_course_id="40977ee8-33ee-4195-b6a2-99a4ca83c2bc",
                country_code="US",
                admin1_code="CA",
                city="Monterey",
                hole_count=18,
                par=72,
            ),
            Course(
                name="Pebble Beach Golf Links",
                region="Portland, OR",
                latitude=45.52,
                longitude=-122.68,
                source="other-provider",
                source_course_id="unrelated-pebble",
                country_code="US",
                admin1_code="OR",
                city="Portland",
            ),
        ])
        session.commit()

        proposals = propose_matches(session)

    assert normalized_name("Pebble-Beach™ Golf Links") == "pebble beach golf links"
    assert [(item.source, item.source_course_id) for item in proposals] == [
        ("opengolfapi", "40977ee8-33ee-4195-b6a2-99a4ca83c2bc")
    ]
    assert proposals[0].hole_count_match is True
    assert proposals[0].par_match is True


def test_explicit_confirmation_is_idempotent_and_rejects_remapping() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        canonical = session.scalar(select(Course).where(Course.source_course_id == "pebble"))
        other = session.scalar(select(Course).where(Course.source_course_id == "spyglass"))
        assert canonical is not None and other is not None
        alias = Course(
            name="Pebble Beach Golf Links",
            region="Pebble Beach, CA",
            latitude=36.5681,
            longitude=-121.9491,
            source="opengolfapi",
            source_course_id="open-pebble",
            country_code="US",
        )
        session.add(alias)
        session.commit()

        first = confirm_mapping(
            session,
            source="opengolfapi",
            source_course_id="open-pebble",
            canonical_course_id=canonical.id,
        )
        second = confirm_mapping(
            session,
            source="opengolfapi",
            source_course_id="open-pebble",
            canonical_course_id=canonical.id,
        )

        assert first.id == second.id
        assert session.scalar(select(func.count()).select_from(CourseReconciliation)) == 1
        with pytest.raises(ValueError, match="different canonical"):
            confirm_mapping(
                session,
                source="opengolfapi",
                source_course_id="open-pebble",
                canonical_course_id=other.id,
            )


def test_relationship_writes_use_the_canonical_course_id() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        canonical = session.scalar(select(Course).where(Course.source_course_id == "pebble"))
        assert canonical is not None
        alias = Course(
            name="Pebble Beach Golf Links",
            region="Pebble Beach, CA",
            latitude=36.5681,
            longitude=-121.9491,
            source="opengolfapi",
            source_course_id="open-pebble",
            country_code="US",
        )
        session.add(alias)
        session.flush()
        alias_id = alias.id
        canonical_id = canonical.id
        session.add(CourseReconciliation(
            source=alias.source,
            source_course_id=alias.source_course_id,
            canonical_course_id=canonical_id,
            match_status="confirmed",
            match_data={},
        ))
        session.commit()

    client = TestClient(app)
    headers = {"X-Development-Subject": "dev:canonical-writes"}
    saved_list = client.post(
        "/api/v1/me/saved-lists",
        headers=headers,
        json={"name": "Canonical", "visibility": "private"},
    ).json()
    saved = client.put(
        f"/api/v1/me/saved-lists/{saved_list['id']}/courses/{alias_id}",
        headers=headers,
        json={},
    )
    round_ = client.post(
        "/api/v1/me/rounds",
        headers=headers,
        json={"course_id": alias_id, "played_on": "2026-07-01"},
    )
    ranking = client.put(
        "/api/v1/me/rankings/tiers",
        headers=headers,
        json={"assignments": [{"course_id": alias_id, "tier": "green"}]},
    )

    assert saved.status_code == 200
    assert saved.json()["courses"][0]["course"]["id"] == canonical_id
    assert round_.status_code == 201
    assert round_.json()["course"]["id"] == canonical_id
    assert ranking.status_code == 200
    assert ranking.json()["entries"][0]["course"]["id"] == canonical_id


def test_existing_alias_activity_and_rating_read_as_canonical_after_confirmation() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        canonical = session.scalar(select(Course).where(Course.source_course_id == "pebble"))
        assert canonical is not None
        alias = Course(
            name="Pebble Beach Golf Links",
            region="Pebble Beach, CA",
            latitude=36.5681,
            longitude=-121.9491,
            source="opengolfapi",
            source_course_id="open-pebble",
            country_code="US",
        )
        session.add(alias)
        session.commit()
        alias_id = alias.id
        canonical_id = canonical.id

    client = TestClient(app)
    headers = {"X-Development-Subject": "dev:existing-alias"}
    rated = client.put(
        f"/api/v1/me/course-ratings/{alias_id}",
        headers=headers,
        json={"tier": "green", "played_on": "2026-07-01", "score": 82},
    )
    assert rated.status_code == 200

    with app.state.session_factory() as session:
        session.add(CourseReconciliation(
            source="opengolfapi",
            source_course_id="open-pebble",
            canonical_course_id=canonical_id,
            match_status="confirmed",
            match_data={},
        ))
        session.commit()

    rating = client.get(f"/api/v1/me/course-ratings/{canonical_id}", headers=headers)
    rounds = client.get("/api/v1/me/rounds", headers=headers)
    feed = client.get("/api/v1/feed", headers=headers)
    detail = client.get(f"/api/v1/courses/{alias_id}")

    assert rating.status_code == 200
    assert rating.json()["course"]["id"] == canonical_id
    assert rating.json()["personal_rating"] is not None
    assert rounds.json()[0]["course"]["id"] == canonical_id
    assert feed.json()["items"][0]["course"]["id"] == canonical_id
    assert detail.json()["id"] == canonical_id
    assert detail.json()["rating_count"] == 1
