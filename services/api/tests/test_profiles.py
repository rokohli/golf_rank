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
        },
    )

    assert response.status_code == 200
    assert response.json()["home_region"] == "Monterey, CA"


def test_profile_is_scoped_to_current_user() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers={"X-Development-Subject": "dev:alice"},
        json={"home_region": "Monterey, CA", "max_green_fee": 250, "difficulty": "any", "access": "any"},
    )

    response = client.get("/api/v1/me/profile", headers={"X-Development-Subject": "dev:bob"})

    assert response.status_code == 404
