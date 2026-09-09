from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.config import Settings
from app.main import create_app
from app.models import Course, CourseImage, CourseImageModeration, CourseImageSource, CourseReconciliation, Profile, User


def test_course_search_filters_by_region_fee_and_access() -> None:
    client = TestClient(create_app())
    response = client.get(
        "/api/v1/courses",
        params={"q": "Pebble", "region": "Monterey, CA", "max_green_fee": 700, "access": "public"},
    )

    assert response.status_code == 200
    assert [course["name"] for course in response.json()] == ["Pebble Beach Golf Links"]


def test_confirmed_course_alias_is_hidden_and_detail_resolves_to_canonical() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        canonical = session.query(Course).filter(Course.source_course_id == "pebble").one()
        alias = Course(
            name="Pebble Beach Golf Links",
            region="Pebble Beach, CA",
            latitude=36.5681,
            longitude=-121.9491,
            is_public=True,
            source="opengolfapi",
            source_course_id="open-pebble",
            country_code="US",
            admin1_code="CA",
            city="Pebble Beach",
            hole_count=18,
            par=72,
        )
        session.add(alias)
        session.flush()
        alias_id = alias.id
        canonical_id = canonical.id
        session.add(CourseReconciliation(
            source=alias.source,
            source_course_id=alias.source_course_id,
            canonical_course_id=canonical.id,
            match_status="confirmed",
            match_data={"reason": "regression fixture"},
        ))
        session.commit()

    client = TestClient(app)
    results = client.get("/api/v1/courses", params={"q": "Pebble"})
    detail = client.get(f"/api/v1/courses/{alias_id}")

    assert [course["id"] for course in results.json()] == [canonical_id]
    assert detail.status_code == 200
    assert detail.json()["id"] == canonical_id


def test_course_search_keeps_unknown_difficulty_courses_discoverable() -> None:
    app = create_app()
    with app.state.session_factory() as session:
        session.add(Course(
            name="Provider Course",
            region="Monterey, CA",
            latitude=36.7,
            longitude=-121.8,
            difficulty=None,
            source="provider",
            source_course_id="provider-course",
            country_code="US",
            admin1_code="CA",
            city="Monterey",
        ))
        session.commit()
    client = TestClient(app)
    response = client.get(
        "/api/v1/courses",
        params={"region": "Monterey, CA", "difficulty": "beginner"},
    )

    assert response.status_code == 200
    assert [course["name"] for course in response.json()] == ["Provider Course"]


def test_course_detail_resolves_a_course_by_id() -> None:
    app = create_app(Settings(course_image_base_url="https://cdn.example/assets"))
    with app.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        session.add_all([
            CourseImage(
                course_id=pebble.id,
                external_url="https://images.example/pebble-hero.jpg",
                alt_text="Pebble Beach coastline",
                source_name="Example photographer",
                source_url="https://images.example/license",
                license_name="CC BY-SA 4.0",
                license_url="https://creativecommons.org/licenses/by-sa/4.0/",
                position=0,
                is_hero=True,
                source_type=CourseImageSource.OFFICIAL,
            ),
            CourseImage(
                course_id=pebble.id,
                storage_key="courses/pebble/second.jpg",
                alt_text="Pebble Beach green",
                source_name="GolfRank photographer",
                source_url="https://golfrank.example/photos/pebble-green",
                position=1,
                source_type=CourseImageSource.OFFICIAL,
            ),
        ])
        session.commit()
    client = TestClient(app)
    course_id = client.get("/api/v1/courses", params={"q": "Spyglass"}).json()[0]["id"]

    response = client.get(f"/api/v1/courses/{course_id}")

    assert response.status_code == 200
    assert response.json()["name"] == "Spyglass Hill Golf Course"

    expected_images = [
        {
            "id": 1,
            "url": "https://images.example/pebble-hero.jpg",
            "alt_text": "Pebble Beach coastline",
            "source_name": "Example photographer",
            "source_url": "https://images.example/license",
            "license_name": "CC BY-SA 4.0",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
            "position": 0,
            "is_hero": True,
            "source_type": "official",
            "quality_score": None,
            "width": None,
            "height": None,
            "uploaded_by_username": None,
            "round_id": None,
        },
        {
            "id": 2,
            "url": "https://cdn.example/assets/courses/pebble/second.jpg",
            "alt_text": "Pebble Beach green",
            "source_name": "GolfRank photographer",
            "source_url": "https://golfrank.example/photos/pebble-green",
            "license_name": None,
            "license_url": None,
            "position": 1,
            "is_hero": False,
            "source_type": "official",
            "quality_score": None,
            "width": None,
            "height": None,
            "uploaded_by_username": None,
            "round_id": None,
        },
    ]

    def _without_created_at(images: list[dict]) -> list[dict]:
        for image in images:
            assert image.pop("created_at")
        return images

    listed_pebble = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]
    pebble_id = listed_pebble["id"]
    assert _without_created_at(listed_pebble["images"]) == expected_images
    pebble_response = client.get(f"/api/v1/courses/{pebble_id}")
    assert pebble_response.status_code == 200
    assert pebble_response.json()["par"] == 72
    assert pebble_response.json()["slope_rating"] == 145
    assert pebble_response.json()["tee_time_url"].startswith("https://www.pebblebeach.com/")
    assert _without_created_at(pebble_response.json()["images"]) == expected_images


def test_course_gallery_includes_images_regardless_of_moderation_status() -> None:
    """Moderation gates hero-image eligibility only (see resolve_hero_image /
    CourseImageRepository.approved_images) -- it never hides a photo from the
    course's own gallery, at any moderation_status."""
    app = create_app(Settings())
    with app.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        session.add_all([
            CourseImage(
                course_id=pebble.id,
                external_url="https://images.example/approved.jpg",
                position=0,
                is_hero=True,
                moderation_status=CourseImageModeration.APPROVED,
                source_type=CourseImageSource.OFFICIAL,
            ),
            CourseImage(
                course_id=pebble.id,
                external_url="https://images.example/pending.jpg",
                position=1,
                moderation_status=CourseImageModeration.PENDING,
                source_type=CourseImageSource.OFFICIAL,
            ),
            CourseImage(
                course_id=pebble.id,
                external_url="https://images.example/rejected.jpg",
                position=2,
                moderation_status=CourseImageModeration.REJECTED,
                source_type=CourseImageSource.OFFICIAL,
            ),
        ])
        session.commit()
    client = TestClient(app)

    listed_pebble = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]

    urls = {image["url"] for image in listed_pebble["images"]}
    assert urls == {
        "https://images.example/approved.jpg",
        "https://images.example/pending.jpg",
        "https://images.example/rejected.jpg",
    }


def test_course_gallery_resolves_many_uploader_usernames_in_one_query() -> None:
    """Regression test: uploader_username() previously ran one session.get()
    per image, adding an N+1 series of profile lookups to a course page with
    photos from many distinct uploaders. course_image_data() must resolve
    every distinct uploader's username with a single batched query."""
    app = create_app(Settings(course_image_base_url="https://cdn.example/assets"))
    with app.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        uploader_ids = []
        for index in range(5):
            user = User(provider_subject=f"dev:gallery-uploader-{index}")
            session.add(user)
            session.flush()
            session.add(Profile(user_id=user.id, home_region="Monterey, CA", username=f"golfer{index}"))
            uploader_ids.append(user.id)
        session.add_all([
            CourseImage(
                course_id=pebble.id, storage_key=f"course-photos/{pebble.id}/{index}.jpg",
                position=index, source_type=CourseImageSource.USER,
                moderation_status=CourseImageModeration.APPROVED, uploaded_by_user_id=user_id,
            )
            for index, user_id in enumerate(uploader_ids)
        ])
        session.commit()
    client = TestClient(app)

    statements: list[str] = []

    def capture_select(_connection, _cursor, statement, _parameters, _context, _many) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(app.state.engine, "before_cursor_execute", capture_select)
    try:
        response = client.get(f"/api/v1/courses/{pebble.id}")
    finally:
        event.remove(app.state.engine, "before_cursor_execute", capture_select)

    assert response.status_code == 200
    usernames = {image["uploaded_by_username"] for image in response.json()["images"]}
    assert usernames == {"golfer0", "golfer1", "golfer2", "golfer3", "golfer4"}
    profile_lookup_statements = [s for s in statements if "profiles" in s.lower()]
    assert len(profile_lookup_statements) == 1


def test_course_gallery_excludes_wikimedia_images() -> None:
    """Wikimedia only ever serves as a hero-image fallback (CourseImageService
    ._resolve) -- it must never surface as a gallery photo."""
    app = create_app(Settings())
    with app.state.session_factory() as session:
        pebble = session.query(Course).filter(Course.name == "Pebble Beach Golf Links").one()
        session.add_all([
            CourseImage(
                course_id=pebble.id,
                external_url="https://images.example/official.jpg",
                position=0,
                is_hero=True,
                source_type=CourseImageSource.OFFICIAL,
            ),
            CourseImage(
                course_id=pebble.id,
                external_url="https://images.example/wikimedia.jpg",
                position=1,
                source_type=CourseImageSource.WIKIMEDIA,
            ),
        ])
        session.commit()
    client = TestClient(app)

    listed_pebble = client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]

    urls = {image["url"] for image in listed_pebble["images"]}
    assert urls == {"https://images.example/official.jpg"}


def test_course_detail_returns_not_found_for_unknown_id() -> None:
    client = TestClient(create_app())

    response = client.get("/api/v1/courses/999999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Course not found"}


def test_course_search_combines_normalized_region_radius_and_stable_cursor() -> None:
    client = TestClient(create_app())
    nearby = client.get(
        "/api/v1/courses",
        params={"country": "US", "admin1": "CA", "lat": 36.568, "lng": -121.949, "radius_miles": 5, "limit": 1},
    )
    assert nearby.status_code == 200
    assert len(nearby.json()) == 1
    assert nearby.json()[0]["name"] == "Pebble Beach Golf Links"
    assert nearby.json()[0]["distance_miles"] == 0.0
    first_id = nearby.json()[0]["id"]
    next_page = client.get("/api/v1/courses", params={"admin1": "CA", "cursor": first_id, "limit": 10})
    assert all(course["id"] > first_id for course in next_page.json())


def test_location_search_sorts_by_distance_and_supports_offset_pagination() -> None:
    client = TestClient(create_app())
    response = client.get(
        "/api/v1/courses",
        params={"lat": 36.568, "lng": -121.949, "radius_miles": 100, "limit": 2},
    )

    assert response.status_code == 200
    distances = [course["distance_miles"] for course in response.json()]
    assert distances == sorted(distances)
    next_page = client.get(
        "/api/v1/courses",
        params={"lat": 36.568, "lng": -121.949, "radius_miles": 100, "limit": 2, "offset": 2},
    )
    assert {course["id"] for course in response.json()}.isdisjoint(
        {course["id"] for course in next_page.json()}
    )


def test_course_regions_and_missing_course_submission() -> None:
    client = TestClient(create_app())
    regions = client.get("/api/v1/course-regions")
    assert regions.status_code == 200
    assert any(item["city"] == "Monterey" and item["course_count"] == 2 for item in regions.json()["regions"])

    headers = {"X-Development-Subject": "dev:catalog-user"}
    client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={"home_region": "Monterey, CA", "max_green_fee": 700, "difficulty": "any", "access": "any"},
    )
    submitted = client.post(
        "/api/v1/course-candidates",
        headers=headers,
        json={"name": "Missing Links", "city": "Carmel", "admin1_code": "ca"},
    )
    assert submitted.status_code == 201
    assert submitted.json()["status"] == "pending"
    assert submitted.json()["admin1_code"] == "CA"
