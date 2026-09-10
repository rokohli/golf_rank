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

    # The admin capability probe. Every *other* admin route deliberately 404s
    # for non-admins, so this is the only one the client can rely on to decide
    # whether to render a moderation entry point.
    assert "/api/v1/me/admin" in paths
    assert "get" in paths["/api/v1/me/admin"]
    assert "is_admin" in schemas.get("AdminAccessOut", {}).get("properties", {})

    # Admin photo moderation.
    assert "get" in paths["/api/v1/admin/course-photos"]
    assert "delete" in paths["/api/v1/admin/course-photos/{image_id}"]
    for action in ("approve", "reject", "feature"):
        assert "post" in paths[f"/api/v1/admin/course-photos/{{image_id}}/{action}"]

    admin_photo_properties = schemas.get("AdminCoursePhotoOut", {}).get("properties", {})
    assert "moderation_status" in admin_photo_properties
    assert "quality_score_reasons" in admin_photo_properties
    assert "moderated_at" in admin_photo_properties
    assert "course_hero_locked" in admin_photo_properties

    # The public per-photo shape must NOT grow moderator-only fields: it is
    # embedded in every course and round payload.
    course_image_properties = schemas.get("CourseImageOut", {}).get("properties", {})
    for moderator_only in ("moderation_reason", "moderated_by_username", "moderated_at"):
        assert moderator_only not in course_image_properties
