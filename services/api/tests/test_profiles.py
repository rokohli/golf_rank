from fastapi.testclient import TestClient

from app.main import create_app


def test_onboarding_upserts_current_user_preferences() -> None:
    client = TestClient(create_app())
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 250,
            "difficulty": "challenging",
            "access": "public",
            "onboarding_data": {
                "first_name": "Alice",
                "last_name": "Golfer",
                "username": "alice",
                "home_course_id": "pebble",
                "home_course_search": "Pebble Beach Golf Links",
                "played_course_ids": ["pebble"],
                "favorite_wins": ["pebble"],
                "dream_course_ids": ["bandon"],
                "preferences": ["Scenic views"],
                "group_size": "Foursome",
                "budget": "$$$",
                "travel_distance": "Up to 45 minutes",
                "preferred_tee_time": "Weekend mornings",
                "transportation": "Cart",
                "notifications": True,
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["home_region"] == "Monterey, CA"
    assert response.json()["onboarding_data"]["played_course_ids"] == ["pebble"]

    profile = client.get(
        "/api/v1/me/profile", headers={"X-Development-Subject": "dev:alice"}
    )
    assert profile.status_code == 200
    assert profile.json()["onboarding_data"]["dream_course_ids"] == ["bandon"]

    legacy_update = client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 300,
            "difficulty": "any",
            "access": "any",
        },
    )
    assert legacy_update.status_code == 200
    assert legacy_update.json()["onboarding_data"]["dream_course_ids"] == ["bandon"]


def test_profile_is_scoped_to_current_user() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={"home_region": "Monterey, CA", "max_green_fee": 250, "difficulty": "any", "access": "any"},
    )

    response = client.get("/api/v1/me/profile", headers={"X-Development-Subject": "dev:bob"})

    assert response.status_code == 404
