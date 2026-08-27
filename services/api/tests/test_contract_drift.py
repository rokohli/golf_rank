from app.main import create_app


def test_openapi_contract_schema_includes_all_critical_models_and_routes() -> None:
    """Verify that FastAPI generated OpenAPI schema includes recent models and endpoints without drift."""
    app = create_app()
    openapi = app.openapi()

    paths = openapi.get("paths", {})
    schemas = openapi.get("components", {}).get("schemas", {})

    # 1. Verify critical endpoints exist
    assert "/api/v1/usernames/available" in paths
    assert "get" in paths["/api/v1/usernames/available"]

    assert "/api/v1/me/onboarding-preferences" in paths
    assert "put" in paths["/api/v1/me/onboarding-preferences"]

    assert "/api/v1/me/rankings" in paths
    assert "get" in paths["/api/v1/me/rankings"]

    assert "/api/v1/me/rankings/friends" in paths
    assert "get" in paths["/api/v1/me/rankings/friends"]

    assert "/api/v1/me/rankings/comparisons" in paths
    assert "post" in paths["/api/v1/me/rankings/comparisons"]

    assert "/api/v1/me/rankings/tiers" in paths
    assert "put" in paths["/api/v1/me/rankings/tiers"]

    # 2. Verify schema models have required fields
    onboarding_data_schema = schemas.get("OnboardingData", {})
    properties = onboarding_data_schema.get("properties", {})
    assert "username" in properties
    assert "first_name" in properties
    assert "last_name" in properties
    assert "played_course_ids" in properties
    assert "favorite_wins" in properties

    ranked_course_schema = schemas.get("RankedCourseOut", {})
    ranked_properties = ranked_course_schema.get("properties", {})
    assert "incomplete" in ranked_properties
    assert "personal_rating" in ranked_properties
    assert "confidence" in ranked_properties
    assert "tier" in ranked_properties

    friend_ranking_schema = schemas.get("FriendRankingOut", {})
    friend_properties = friend_ranking_schema.get("properties", {})
    assert "user" in friend_properties
    assert "entries" in friend_properties
