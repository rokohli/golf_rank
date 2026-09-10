from datetime import datetime, timezone
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.course_images.repository import CourseImageRepository
from app.main import create_app
from app.models import (
    Course,
    CourseImage,
    CourseImageModeration,
    CourseImageModerationAction,
    CourseImageSource,
    FailedObjectDeletion,
    Profile,
    User,
)
from app.storage import ObjectMeta, ObjectStorage, PresignedUpload

ADMIN = {"X-Development-Subject": "dev:admin"}
REGULAR = {"X-Development-Subject": "dev:regular"}
BASE = "/api/v1/admin/course-photos"
CDN = "https://cdn.example"

_repository = CourseImageRepository()


class FakeObjectStorage(ObjectStorage):
    """Mirrors tests/test_course_photo_uploads.py's fake."""

    def __init__(self, *, delete_succeeds: bool = True) -> None:
        self.objects: dict[str, ObjectMeta] = {}
        self.deleted: list[str] = []
        self._delete_succeeds = delete_succeeds

    def create_course_photo_upload(self, *, course_id, content_type, expires_in_seconds):
        from app.storage import ALLOWED_CONTENT_TYPES, build_storage_key

        if content_type not in ALLOWED_CONTENT_TYPES:
            return None
        key = build_storage_key(course_id, content_type)
        return PresignedUpload(url=f"https://fake-r2.example/{key}", storage_key=key)

    def head_object(self, storage_key: str) -> ObjectMeta | None:
        return self.objects.get(storage_key)

    def delete_object(self, storage_key: str) -> bool:
        self.deleted.append(storage_key)
        if not self._delete_succeeds:
            return False
        self.objects.pop(storage_key, None)
        return True

    def promote_object(self, pending_key: str, permanent_key: str) -> None:
        self.objects[permanent_key] = self.objects[pending_key]


def _client(
    *, admin_clerk_subjects: str = "dev:admin", object_storage: ObjectStorage | None = None,
) -> TestClient:
    app = create_app(Settings(
        wikimedia_live_lookup_enabled=False,
        course_image_base_url=CDN,
        admin_clerk_subjects=admin_clerk_subjects,
    ))
    app.state.object_storage = object_storage if object_storage is not None else FakeObjectStorage()
    return TestClient(app)


def _course_id(client: TestClient) -> int:
    return client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]


def _add_photo(
    client: TestClient, course_id: int, *,
    source_type: str = CourseImageSource.USER,
    status: str = CourseImageModeration.PENDING,
    is_hero: bool = False,
    quality_score: float | None = None,
    key: str | None = None,
    round_id: int | None = None,
    attempts: int = 0,
    scoring_claimed_at: datetime | None = None,
) -> int:
    """Inserts a photo directly -- the upload path is covered by its own tests."""
    with client.app.state.session_factory() as session:
        image = CourseImage(
            course_id=course_id,
            storage_key=key or f"course-photos/{course_id}/{source_type}-{status}-{is_hero}-{quality_score}.jpg",
            alt_text="photo",
            position=_repository.next_position(session, course_id),
            is_hero=is_hero,
            source_type=source_type,
            moderation_status=status,
            quality_score=quality_score,
            round_id=round_id,
            scoring_attempts=attempts,
            scoring_claimed_at=scoring_claimed_at,
        )
        session.add(image)
        session.commit()
        return image.id


def _photo(client: TestClient, image_id: int) -> CourseImage | None:
    with client.app.state.session_factory() as session:
        return session.get(CourseImage, image_id)


def _gallery_ids(client: TestClient, course_id: int) -> list[int]:
    body = client.get(f"/api/v1/courses/{course_id}", headers=REGULAR).json()
    return [image["id"] for image in body.get("images", [])]


# --- authorization --------------------------------------------------------


def test_every_route_404s_for_a_non_admin() -> None:
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)

    assert client.get(BASE, headers=REGULAR).status_code == 404
    assert client.post(f"{BASE}/{image_id}/approve", headers=REGULAR).status_code == 404
    assert client.post(f"{BASE}/{image_id}/reject", json={}, headers=REGULAR).status_code == 404
    assert client.post(
        f"{BASE}/{image_id}/feature", json={"featured": True}, headers=REGULAR
    ).status_code == 404
    assert client.delete(f"{BASE}/{image_id}", headers=REGULAR).status_code == 404


def test_unauthenticated_gets_401_not_404() -> None:
    # 401 must win over the admin 404: the caller has no identity at all yet,
    # and collapsing that into 404 would misreport a missing token.
    assert _client().get(BASE).status_code == 401


def test_admin_routes_404_when_no_admins_are_configured() -> None:
    client = _client(admin_clerk_subjects="")

    assert client.get(BASE, headers=ADMIN).status_code == 404


# --- the queue ------------------------------------------------------------


def test_queue_lists_only_pending_user_photos() -> None:
    client = _client()
    course_id = _course_id(client)
    pending = _add_photo(client, course_id)
    _add_photo(client, course_id, status=CourseImageModeration.APPROVED)
    _add_photo(client, course_id, source_type=CourseImageSource.WIKIMEDIA,
               status=CourseImageModeration.APPROVED)
    _add_photo(client, course_id, source_type=CourseImageSource.OFFICIAL,
               status=CourseImageModeration.APPROVED)

    body = client.get(BASE, headers=ADMIN).json()

    assert [item["image"]["id"] for item in body["items"]] == [pending]
    assert body["items"][0]["course_name"]
    assert body["items"][0]["moderation_status"] == "pending"


def test_queue_filters_by_status_and_course() -> None:
    client = _client()
    course_id = _course_id(client)
    _add_photo(client, course_id)
    rejected = _add_photo(client, course_id, status=CourseImageModeration.REJECTED)

    body = client.get(BASE, params={"status": "rejected"}, headers=ADMIN).json()
    assert [item["image"]["id"] for item in body["items"]] == [rejected]

    other = client.get(BASE, params={"course_id": course_id + 999}, headers=ADMIN).json()
    assert other["items"] == []


def test_queue_rejects_an_unknown_status() -> None:
    assert _client().get(BASE, params={"status": "bogus"}, headers=ADMIN).status_code == 422


def test_queue_paginates_by_cursor_oldest_first() -> None:
    client = _client()
    course_id = _course_id(client)
    first = _add_photo(client, course_id, key="a.jpg")
    second = _add_photo(client, course_id, key="b.jpg")

    page_one = client.get(BASE, params={"limit": 1}, headers=ADMIN).json()
    assert [item["image"]["id"] for item in page_one["items"]] == [first]
    assert page_one["next_cursor"] == first

    page_two = client.get(
        BASE, params={"limit": 1, "cursor": page_one["next_cursor"]}, headers=ADMIN
    ).json()
    assert [item["image"]["id"] for item in page_two["items"]] == [second]
    # Last page must not advertise another one.
    assert page_two["next_cursor"] is None


def test_queue_rejects_out_of_range_limits() -> None:
    client = _client()

    assert client.get(BASE, params={"limit": 0}, headers=ADMIN).status_code == 422
    assert client.get(BASE, params={"limit": 101}, headers=ADMIN).status_code == 422


def test_queue_reports_whether_the_courses_hero_is_locked() -> None:
    client = _client()
    course_id = _course_id(client)
    _add_photo(client, course_id, key="pending.jpg")

    assert client.get(BASE, headers=ADMIN).json()["items"][0]["course_hero_locked"] is False

    _add_photo(client, course_id, status=CourseImageModeration.APPROVED,
               is_hero=True, key="featured.jpg")

    assert client.get(BASE, headers=ADMIN).json()["items"][0]["course_hero_locked"] is True


def test_queue_reports_is_scoring_and_scoring_exhausted() -> None:
    client = _client()
    course_id = _course_id(client)
    now = datetime.now(timezone.utc)

    id1 = _add_photo(client, course_id, key="claiming.jpg", attempts=1, scoring_claimed_at=now)
    id2 = _add_photo(client, course_id, key="exhausted.jpg", attempts=3)

    items = client.get(BASE, headers=ADMIN).json()["items"]
    by_id = {item["image"]["id"]: item for item in items}

    assert by_id[id1]["is_scoring"] is True
    assert by_id[id1]["scoring_exhausted"] is False

    assert by_id[id2]["is_scoring"] is False
    assert by_id[id2]["scoring_exhausted"] is True


# --- approve --------------------------------------------------------------


def test_approve_makes_the_photo_hero_eligible_without_featuring_it() -> None:
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)

    body = client.post(f"{BASE}/{image_id}/approve", headers=ADMIN).json()

    assert body["moderation_status"] == "approved"
    assert body["moderated_at"] is not None
    # Approval grants eligibility only; is_hero stays a human's explicit pick,
    # so a later feature can still win.
    assert body["image"]["is_hero"] is False

    hero = client.get(f"/api/v1/courses/{course_id}", headers=REGULAR).json()["hero_image"]
    assert hero["type"] == "USER"


def test_approve_is_idempotent() -> None:
    client = _client()
    image_id = _add_photo(client, _course_id(client))

    first = client.post(f"{BASE}/{image_id}/approve", headers=ADMIN)
    second = client.post(f"{BASE}/{image_id}/approve", headers=ADMIN)

    assert first.status_code == second.status_code == 200
    assert second.json()["moderation_status"] == "approved"


# --- reject ---------------------------------------------------------------


def test_reject_records_a_reason_and_clears_is_hero() -> None:
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id, status=CourseImageModeration.APPROVED, is_hero=True)

    body = client.post(
        f"{BASE}/{image_id}/reject", json={"reason": "people in frame"}, headers=ADMIN
    ).json()

    assert body["moderation_status"] == "rejected"
    assert body["moderation_reason"] == "people in frame"
    # Must clear is_hero, or re-approving would send it straight back to the
    # top of its tier on _rank_key's first term.
    assert body["image"]["is_hero"] is False


def test_reject_keeps_the_photo_visible_and_keeps_its_object() -> None:
    """Moderation governs hero eligibility, not visibility. Rejecting must not
    hide the photo -- only DELETE removes it."""
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)

    client.post(f"{BASE}/{image_id}/reject", json={}, headers=ADMIN)

    assert image_id in _gallery_ids(client, course_id)
    assert storage.deleted == []
    assert _photo(client, image_id) is not None


def test_pending_photos_are_visible_too() -> None:
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)

    assert image_id in _gallery_ids(client, course_id)


def test_rejected_photo_cannot_win_the_hero_tier() -> None:
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)
    client.post(f"{BASE}/{image_id}/reject", json={}, headers=ADMIN)

    hero = client.get(f"/api/v1/courses/{course_id}", headers=REGULAR).json()["hero_image"]

    assert hero["type"] != "USER"


# --- feature --------------------------------------------------------------


def test_feature_approves_and_clears_siblings_in_the_same_tier() -> None:
    client = _client()
    course_id = _course_id(client)
    first = _add_photo(client, course_id, status=CourseImageModeration.APPROVED,
                       is_hero=True, key="first.jpg")
    second = _add_photo(client, course_id, key="second.jpg")
    third = _add_photo(client, course_id, status=CourseImageModeration.APPROVED,
                       is_hero=False, key="third.jpg")

    body = client.post(f"{BASE}/{second}/feature", json={"featured": True}, headers=ADMIN).json()

    # Featuring implies approving: without it the flag would be set on a
    # PENDING row that approved_images filters out -- a silent no-op.
    assert body["moderation_status"] == "approved"
    assert body["image"]["is_hero"] is True
    first_row = _photo(client, first)
    assert first_row.is_hero is False
    assert first_row.moderation_action == CourseImageModerationAction.UNFEATURED
    assert first_row.moderated_at is not None
    assert first_row.moderated_by_user_id is not None
    assert first_row.moderation_reason is None

    # Non-hero sibling is untouched in its audit action
    third_row = _photo(client, third)
    assert third_row.is_hero is False
    assert third_row.moderation_action != CourseImageModerationAction.UNFEATURED



def test_feature_does_not_touch_another_tiers_hero() -> None:
    client = _client()
    course_id = _course_id(client)
    wikimedia = _add_photo(client, course_id, source_type=CourseImageSource.WIKIMEDIA,
                           status=CourseImageModeration.APPROVED, is_hero=True, key="wiki.jpg")
    user_photo = _add_photo(client, course_id, key="user.jpg")

    client.post(f"{BASE}/{user_photo}/feature", json={"featured": True}, headers=ADMIN)

    assert _photo(client, wikimedia).is_hero is True


def test_feature_repairs_a_pre_existing_duplicate_hero() -> None:
    """Nothing historically enforced one is_hero per tier, so the endpoint must
    repair a violated state rather than assume it can't happen."""
    client = _client()
    course_id = _course_id(client)
    first = _add_photo(client, course_id, status=CourseImageModeration.APPROVED,
                       is_hero=True, key="one.jpg")
    second = _add_photo(client, course_id, status=CourseImageModeration.APPROVED,
                        is_hero=True, key="two.jpg")

    client.post(f"{BASE}/{second}/feature", json={"featured": True}, headers=ADMIN)

    assert _photo(client, first).is_hero is False
    assert _photo(client, second).is_hero is True


def test_unfeature_clears_only_that_row() -> None:
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id, status=CourseImageModeration.APPROVED, is_hero=True)

    body = client.post(f"{BASE}/{image_id}/feature", json={"featured": False}, headers=ADMIN).json()

    assert body["image"]["is_hero"] is False
    # Unfeaturing must not also un-approve.
    assert body["moderation_status"] == "approved"


# --- delete ---------------------------------------------------------------


def test_delete_removes_the_row_and_the_object() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id, key="course-photos/1/gone.jpg")

    response = client.delete(f"{BASE}/{image_id}", headers=ADMIN)

    assert response.status_code == 204
    assert _photo(client, image_id) is None
    assert storage.deleted == ["course-photos/1/gone.jpg"]
    assert image_id not in _gallery_ids(client, course_id)


def test_delete_records_a_failed_object_deletion_for_retry() -> None:
    storage = FakeObjectStorage(delete_succeeds=False)
    client = _client(object_storage=storage)
    image_id = _add_photo(client, _course_id(client), key="course-photos/1/stuck.jpg")

    client.delete(f"{BASE}/{image_id}", headers=ADMIN)

    with client.app.state.session_factory() as session:
        recorded = session.query(FailedObjectDeletion).all()
    assert [(row.storage_key, row.context) for row in recorded] == [
        ("course-photos/1/stuck.jpg", "moderation_delete")
    ]


def test_delete_still_removes_the_row_when_storage_is_unconfigured() -> None:
    """delete_permanent_objects handles storage=None by recording every key for
    retry, so an R2 outage must not block removing the row."""
    client = _client()
    client.app.state.object_storage = None
    image_id = _add_photo(client, _course_id(client), key="course-photos/1/orphan.jpg")

    assert client.delete(f"{BASE}/{image_id}", headers=ADMIN).status_code == 204
    assert _photo(client, image_id) is None
    with client.app.state.session_factory() as session:
        assert session.query(FailedObjectDeletion).count() == 1


def test_delete_is_not_repeatable() -> None:
    client = _client()
    image_id = _add_photo(client, _course_id(client))

    assert client.delete(f"{BASE}/{image_id}", headers=ADMIN).status_code == 204
    assert client.delete(f"{BASE}/{image_id}", headers=ADMIN).status_code == 404


def test_deleting_leaves_a_position_hole_that_does_not_block_new_photos() -> None:
    client = _client()
    course_id = _course_id(client)
    first = _add_photo(client, course_id, key="a.jpg")
    _add_photo(client, course_id, key="b.jpg")

    client.delete(f"{BASE}/{first}", headers=ADMIN)

    # next_position is max+1, not count, so the hole is harmless.
    assert _add_photo(client, course_id, key="c.jpg")


# --- scoping --------------------------------------------------------------


def test_actions_404_for_a_non_user_photo() -> None:
    client = _client()
    course_id = _course_id(client)
    wikimedia = _add_photo(client, course_id, source_type=CourseImageSource.WIKIMEDIA,
                           status=CourseImageModeration.APPROVED)

    assert client.post(f"{BASE}/{wikimedia}/approve", headers=ADMIN).status_code == 404
    assert client.delete(f"{BASE}/{wikimedia}", headers=ADMIN).status_code == 404


def test_actions_404_for_a_missing_photo() -> None:
    assert _client().post(f"{BASE}/999999/approve", headers=ADMIN).status_code == 404


def test_audit_fields_updated_across_different_moderators() -> None:
    client = _client(admin_clerk_subjects="dev:admin-a,dev:admin-b,dev:admin-c")
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id, key="photo.jpg")

    with client.app.state.session_factory() as session:
        for sub, uname in [("dev:admin-a", "admin_a"), ("dev:admin-b", "admin_b"), ("dev:admin-c", "admin_c")]:
            u = User(provider_subject=sub)
            session.add(u)
            session.flush()
            session.add(Profile(user_id=u.id, username=uname, home_region="CA"))
        session.commit()

    admin_a = {"X-Development-Subject": "dev:admin-a"}
    admin_b = {"X-Development-Subject": "dev:admin-b"}
    admin_c = {"X-Development-Subject": "dev:admin-c"}

    # 1. Admin A approves
    res_a = client.post(f"{BASE}/{image_id}/approve", headers=admin_a).json()
    assert res_a["moderation_status"] == "approved"
    assert res_a["moderated_by_username"] == "admin_a"
    assert res_a["moderation_action"] == "approved"
    assert res_a["moderated_at"] is not None
    assert res_a["image"]["is_hero"] is False

    # 2. Admin B features
    res_b = client.post(f"{BASE}/{image_id}/feature", json={"featured": True}, headers=admin_b).json()
    assert res_b["image"]["is_hero"] is True
    assert res_b["moderation_status"] == "approved"
    assert res_b["moderated_by_username"] == "admin_b"
    assert res_b["moderation_action"] == "featured"
    assert res_b["moderated_at"] >= res_a["moderated_at"]

    # 3. Admin C unfeatures
    res_c = client.post(f"{BASE}/{image_id}/feature", json={"featured": False}, headers=admin_c).json()
    assert res_c["image"]["is_hero"] is False
    assert res_c["moderation_status"] == "approved"
    assert res_c["moderated_by_username"] == "admin_c"
    assert res_c["moderation_action"] == "unfeatured"
    assert res_c["moderated_at"] >= res_b["moderated_at"]


def test_queue_query_count_bounded_independently_of_page_size() -> None:
    from sqlalchemy import event
    client = _client()
    app = client.app
    engine = app.state.engine

    # Seed 5 courses with 2 photos each from different users
    with app.state.session_factory() as session:
        for c_idx in range(5):
            course = Course(name=f"Course {c_idx}", region="CA", latitude=37.0, longitude=-122.0)
            session.add(course)
            session.flush()
            for p_idx in range(2):
                uploader = User(provider_subject=f"dev:uploader-{c_idx}-{p_idx}")
                session.add(uploader)
                session.flush()
                session.add(Profile(user_id=uploader.id, username=f"user_{c_idx}_{p_idx}", home_region="CA"))
                session.add(CourseImage(
                    course_id=course.id,
                    storage_key=f"key-{c_idx}-{p_idx}.jpg",
                    position=p_idx,
                    source_type=CourseImageSource.USER,
                    moderation_status=CourseImageModeration.PENDING,
                    uploaded_by_user_id=uploader.id,
                ))
        session.commit()

    queries = []

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        res = client.get(BASE, params={"limit": 50}, headers=ADMIN)
        assert res.status_code == 200
        data = res.json()
        assert len(data["items"]) >= 10
        # Queries executed should be strictly bounded:
        # 1: course_images queue query
        # 2: courses name lookup
        # 3: batch_has_featured_hero lookup
        # 4: batch_uploader_usernames profile lookup
        assert len(queries) <= 4, f"Expected at most 4 queries, got {len(queries)}: {queries}"
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


def test_feature_and_unfeature_clears_prior_rejection_reason() -> None:
    """Verifies Finding 3: featuring or unfeaturing a photo clears any prior rejection
    reason so audit UI does not display 'Featured by @user · rejection reason'."""
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)

    reject_res = client.post(
        f"{BASE}/{image_id}/reject", json={"reason": "people in frame"}, headers=ADMIN
    )
    assert reject_res.status_code == 200
    reject_body = reject_res.json()
    assert reject_body["moderation_status"] == "rejected"
    assert reject_body["moderation_reason"] == "people in frame"
    assert reject_body["moderation_action"] == "rejected"

    feature_res = client.post(
        f"{BASE}/{image_id}/feature", json={"featured": True}, headers=ADMIN
    )
    assert feature_res.status_code == 200
    feature_body = feature_res.json()
    assert feature_body["moderation_status"] == "approved"
    assert feature_body["image"]["is_hero"] is True
    assert feature_body["moderation_action"] == "featured"
    assert feature_body["moderation_reason"] is None

    unfeature_res = client.post(
        f"{BASE}/{image_id}/feature", json={"featured": False}, headers=ADMIN
    )
    assert unfeature_res.status_code == 200
    unfeature_body = unfeature_res.json()
    assert unfeature_body["moderation_status"] == "approved"
    assert unfeature_body["image"]["is_hero"] is False
    assert unfeature_body["moderation_action"] == "unfeatured"
    assert unfeature_body["moderation_reason"] is None


def test_feature_user_image_refreshes_stale_identity_map_and_sets_approved() -> None:
    """Verifies Finding 1: feature_user_image refreshes cached session attributes when locking
    and unconditionally ensures moderation_status = approved even if target was rejected concurrently."""
    client = _client()
    course_id = _course_id(client)
    image_id = _add_photo(client, course_id)

    factory = client.app.state.session_factory
    with factory() as session:
        user = User(provider_subject="dev:moderator")
        session.add(user)
        session.commit()
        moderator_id = user.id

        # Preload target image into session identity map with APPROVED status
        repo = CourseImageRepository()
        img = session.get(CourseImage, image_id)
        assert img is not None
        img.moderation_status = CourseImageModeration.APPROVED
        session.commit()

        # Another session rejects the image concurrently
        with factory() as other_session:
            other_img = other_session.get(CourseImage, image_id)
            assert other_img is not None
            repo.set_moderation(
                other_session,
                other_img,
                status=CourseImageModeration.REJECTED,
                moderated_by_user_id=moderator_id,
                reason="rejected concurrently",
            )

        # In the original session, calling feature_user_image must lock rows, refresh target,
        # and ensure it is APPROVED and hero
        featured_img = repo.feature_user_image(session, image_id, featured=True, moderator_user_id=moderator_id)
        assert featured_img is not None
        assert featured_img.is_hero is True
        assert featured_img.moderation_status == CourseImageModeration.APPROVED
        assert featured_img.moderated_by_user_id == moderator_id
        assert featured_img.moderation_action == "featured"

        # Verify persisted state in a fresh session
        with factory() as verify_session:
            db_img = verify_session.get(CourseImage, image_id)
            assert db_img is not None
            assert db_img.is_hero is True
            assert db_img.moderation_status == CourseImageModeration.APPROVED
            assert db_img.moderated_by_user_id == moderator_id
            assert db_img.moderation_action == "featured"
