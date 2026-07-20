from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import create_app
from app.models import Follow, OnboardingPreference, Profile, RankingSnapshot, User, UserBlock


HEADERS = {"X-Development-Subject": "dev:ranker"}


def test_tier_placements_create_an_ordered_ten_point_ranking() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={
            "assignments": [
                {"course_id": 1, "tier": "green", "position": 1},
                {"course_id": 2, "tier": "green", "position": 2},
                {"course_id": 3, "tier": "fairway", "position": 1},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert [entry["course"]["id"] for entry in body["entries"]] == [1, 2, 3]
    assert [entry["personal_rating"] for entry in body["entries"]] == [10.0, 8.5, 7.7]
    assert all(1 <= entry["personal_rating"] <= 10 for entry in body["entries"])
    assert all("stars" not in entry for entry in body["entries"])


def test_ranking_entries_include_current_round_count_and_best_score() -> None:
    client = TestClient(create_app())
    for played_on, score in (("2026-07-01", 88), ("2026-07-02", 82)):
        assert client.post(
            "/api/v1/me/rounds",
            headers=HEADERS,
            json={"course_id": 1, "played_on": played_on, "score": score},
        ).status_code == 201
    assert client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [{"course_id": 1, "tier": "green"}]},
    ).status_code == 200

    entry = client.get("/api/v1/me/rankings", headers=HEADERS).json()["entries"][0]

    assert entry["round_count"] == 2
    assert entry["best_score"] == 82


def test_friends_rankings_return_mutual_friends_with_their_round_stats() -> None:
    app = create_app()
    client = TestClient(app)
    alice_headers = {"X-Development-Subject": "dev:alice-ranker"}
    bob_headers = {"X-Development-Subject": "dev:bob-ranker"}
    assert client.put(
        "/api/v1/me/rankings/tiers",
        headers=alice_headers,
        json={"assignments": [{"course_id": 2, "tier": "fairway"}]},
    ).status_code == 200
    assert client.put(
        "/api/v1/me/rankings/tiers",
        headers=bob_headers,
        json={"assignments": [{"course_id": 1, "tier": "green"}]},
    ).status_code == 200
    for played_on, score in (("2026-07-01", 86), ("2026-07-02", 79)):
        assert client.post(
            "/api/v1/me/rounds",
            headers=bob_headers,
            json={"course_id": 1, "played_on": played_on, "score": score},
        ).status_code == 201

    with app.state.session_factory() as session:
        alice = session.scalar(select(User).where(User.provider_subject == "dev:alice-ranker"))
        bob = session.scalar(select(User).where(User.provider_subject == "dev:bob-ranker"))
        assert alice is not None and bob is not None
        session.add_all([
            Follow(follower_id=alice.id, followed_id=bob.id),
            Follow(follower_id=bob.id, followed_id=alice.id),
            Profile(user_id=bob.id, home_region="Monterey, CA"),
            OnboardingPreference(
                user_id=bob.id,
                max_green_fee=300,
                difficulty="any",
                access="any",
                onboarding_data={"first_name": "Bob", "last_name": "Jones", "username": "bobgolfs"},
            ),
        ])
        session.commit()

    response = client.get("/api/v1/me/rankings/friends", headers=alice_headers)

    assert response.status_code == 200
    assert len(response.json()) == 1
    friend = response.json()[0]
    assert friend["user"] == {
        "id": friend["user"]["id"],
        "display_name": "Bob Jones",
        "username": "bobgolfs",
        "home_region": "Monterey, CA",
    }
    assert friend["entries"][0]["round_count"] == 2
    assert friend["entries"][0]["best_score"] == 79


def test_friends_rankings_exclude_one_way_follows_and_blocks() -> None:
    app = create_app()
    client = TestClient(app)
    alice_headers = {"X-Development-Subject": "dev:alice-private"}
    bob_headers = {"X-Development-Subject": "dev:bob-private"}
    for headers in (alice_headers, bob_headers):
        assert client.put(
            "/api/v1/me/rankings/tiers",
            headers=headers,
            json={"assignments": [{"course_id": 1, "tier": "green"}]},
        ).status_code == 200

    with app.state.session_factory() as session:
        alice = session.scalar(select(User).where(User.provider_subject == "dev:alice-private"))
        bob = session.scalar(select(User).where(User.provider_subject == "dev:bob-private"))
        assert alice is not None and bob is not None
        session.add(Follow(follower_id=alice.id, followed_id=bob.id))
        session.commit()

    assert client.get("/api/v1/me/rankings/friends", headers=alice_headers).json() == []

    with app.state.session_factory() as session:
        alice = session.scalar(select(User).where(User.provider_subject == "dev:alice-private"))
        bob = session.scalar(select(User).where(User.provider_subject == "dev:bob-private"))
        assert alice is not None and bob is not None
        session.add_all([
            Follow(follower_id=bob.id, followed_id=alice.id),
            UserBlock(blocker_id=bob.id, blocked_id=alice.id),
        ])
        session.commit()

    assert client.get("/api/v1/me/rankings/friends", headers=alice_headers).json() == []


def test_decisive_comparison_reorders_within_tier_and_versions_snapshot() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "green"},
            {"course_id": 2, "tier": "green"},
        ]},
    )

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "course_b"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 2
    assert [entry["course"]["id"] for entry in body["entries"]] == [2, 1]
    assert all(entry["confidence"] == 0.5 for entry in body["entries"])

    fetched = client.get("/api/v1/me/rankings", headers=HEADERS)
    assert fetched.status_code == 200
    assert fetched.json()["version"] == 2
    assert fetched.json()["entries"] == body["entries"]


def test_uncertain_comparison_preserves_order_and_reduces_confidence() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "rough"},
            {"course_id": 2, "tier": "rough"},
        ]},
    )

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "too_close"},
    )

    assert response.status_code == 200
    assert [entry["course"]["id"] for entry in response.json()["entries"]] == [1, 2]
    assert all(entry["confidence"] == 0.25 for entry in response.json()["entries"])


def test_comparison_rejects_removed_not_sure_result() -> None:
    client = TestClient(create_app())

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "not_sure"},
    )

    assert response.status_code == 422


def test_comparison_requires_two_courses_in_the_same_tier() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "green"},
            {"course_id": 2, "tier": "fairway"},
        ]},
    )

    response = client.post(
        "/api/v1/me/rankings/comparisons",
        headers=HEADERS,
        json={"course_a_id": 1, "course_b_id": 2, "result": "course_a"},
    )

    assert response.status_code == 409


def test_ranking_is_private_to_the_current_user() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [{"course_id": 1, "tier": "green"}]},
    )

    response = client.get(
        "/api/v1/me/rankings",
        headers={"X-Development-Subject": "dev:someone-else"},
    )

    assert response.status_code == 200
    assert response.json()["version"] == 0
    assert response.json()["entries"] == []


def test_not_sure_holds_course_outside_ranking_without_inventing_a_rating() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "green"},
            {"course_id": 2, "tier": "not_sure"},
        ]},
    )

    assert response.status_code == 200
    assert [entry["course"]["id"] for entry in response.json()["entries"]] == [1]
    assert [course["id"] for course in response.json()["unranked_courses"]] == [2]


def test_single_course_tier_move_inserts_at_requested_position() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [
            {"course_id": 1, "tier": "green"},
            {"course_id": 2, "tier": "green"},
            {"course_id": 3, "tier": "green"},
        ]},
    )

    response = client.put(
        "/api/v1/me/rankings/tiers",
        headers=HEADERS,
        json={"assignments": [{"course_id": 3, "tier": "green", "position": 1}]},
    )

    assert response.status_code == 200
    assert [entry["course"]["id"] for entry in response.json()["entries"]] == [3, 1, 2]


def test_legacy_snapshot_tiers_are_adapted_without_rewriting_history() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        user = User(provider_subject="dev:legacy-ranker")
        session.add(user)
        session.flush()
        legacy_tiers = ("loved_it", "liked_it", "fine", "no")
        legacy_ranking_data = {
            "entries": [
                {
                    "rank": rank,
                    "course": {
                        "id": rank,
                        "name": f"Legacy Course {rank}",
                        "region": "Monterey Bay",
                        "green_fee": 625,
                        "difficulty": "challenging",
                        "is_public": True,
                    },
                    "tier": tier,
                    "tier_position": 1,
                    "personal_rating": rating,
                    "confidence": 0.35,
                    "confidence_label": "low",
                }
                for rank, (tier, rating) in enumerate(
                    zip(legacy_tiers, (9.2, 7.7, 6.0, 3.0), strict=True),
                    start=1,
                )
            ],
            "unranked_courses": [],
        }
        session.add(
            RankingSnapshot(
                user_id=user.id,
                version=1,
                algorithm_version="tier-linear-v1",
                overall_confidence=0.35,
                ranking_data=legacy_ranking_data,
            )
        )
        session.commit()

    response = TestClient(app).get(
        "/api/v1/me/rankings",
        headers={"X-Development-Subject": "dev:legacy-ranker"},
    )

    assert response.status_code == 200
    assert [entry["tier"] for entry in response.json()["entries"]] == [
        "green",
        "fairway",
        "rough",
        "bunker",
    ]
    with app.state.session_factory() as session:
        stored = session.scalar(select(RankingSnapshot))
        assert stored is not None
        assert [entry["tier"] for entry in stored.ranking_data["entries"]] == list(
            legacy_tiers
        )
