from fastapi.testclient import TestClient

from app.core.config import Settings
from app.course_images.repository import CourseImageRepository
from app.main import create_app
from app.models import (
    Course,
    CourseImage,
    CourseImageModeration,
    CourseImageSource,
    FailedObjectDeletion,
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

    body = client.post(f"{BASE}/{second}/feature", json={"featured": True}, headers=ADMIN).json()

    # Featuring implies approving: without it the flag would be set on a
    # PENDING row that approved_images filters out -- a silent no-op.
    assert body["moderation_status"] == "approved"
    assert body["image"]["is_hero"] is True
    assert _photo(client, first).is_hero is False


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
