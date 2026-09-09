import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import Course, CourseImage, CourseImageModeration
from app.storage import ObjectMeta, ObjectStorage, PresignedUpload, promote_storage_key

HEADERS = {"X-Development-Subject": "dev:photo-uploader"}


class FakeObjectStorage(ObjectStorage):
    def __init__(self) -> None:
        self.objects: dict[str, ObjectMeta] = {}
        self.deleted: list[str] = []

    def create_course_photo_upload(self, *, course_id: int, content_type: str, expires_in_seconds: int) -> PresignedUpload | None:
        from app.storage import ALLOWED_CONTENT_TYPES, build_storage_key

        if content_type not in ALLOWED_CONTENT_TYPES:
            return None
        key = build_storage_key(course_id, content_type)
        return PresignedUpload(url=f"https://fake-r2.example/{key}", storage_key=key)

    def head_object(self, storage_key: str) -> ObjectMeta | None:
        return self.objects.get(storage_key)

    def delete_object(self, storage_key: str) -> bool:
        self.objects.pop(storage_key, None)
        self.deleted.append(storage_key)
        return True

    def promote_object(self, pending_key: str, permanent_key: str) -> None:
        # Mirrors R2ObjectStorage.promote_object: copies, leaves the pending
        # copy in place (the lifecycle rule reclaims it in real R2).
        self.objects[permanent_key] = self.objects[pending_key]


def _client(*, object_storage: ObjectStorage | None, course_image_base_url: str | None = None) -> TestClient:
    app = create_app(Settings(wikimedia_live_lookup_enabled=False, course_image_base_url=course_image_base_url))
    app.state.object_storage = object_storage
    return TestClient(app)


def _pebble_id(client: TestClient) -> int:
    return client.get("/api/v1/courses", params={"q": "Pebble"}).json()[0]["id"]


def test_upload_url_requires_auth() -> None:
    client = _client(object_storage=FakeObjectStorage())
    course_id = _pebble_id(client)

    response = client.post(f"/api/v1/courses/{course_id}/photos/upload-url", json={"content_type": "image/jpeg"})

    assert response.status_code == 401


def test_upload_url_503_when_storage_not_configured() -> None:
    client = _client(object_storage=None)
    course_id = _pebble_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/upload-url", json={"content_type": "image/jpeg"}, headers=HEADERS,
    )

    assert response.status_code == 503


def test_upload_url_404_for_missing_course() -> None:
    client = _client(object_storage=FakeObjectStorage())

    response = client.post(
        "/api/v1/courses/999999/photos/upload-url", json={"content_type": "image/jpeg"}, headers=HEADERS,
    )

    assert response.status_code == 404


def test_upload_url_422_for_disallowed_content_type() -> None:
    client = _client(object_storage=FakeObjectStorage())
    course_id = _pebble_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/upload-url", json={"content_type": "image/gif"}, headers=HEADERS,
    )

    assert response.status_code == 422


def test_upload_url_returns_scoped_storage_key() -> None:
    client = _client(object_storage=FakeObjectStorage())
    course_id = _pebble_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/upload-url", json={"content_type": "image/jpeg"}, headers=HEADERS,
    )

    assert response.status_code == 201
    body = response.json()
    # Lands under course-photos/pending/ -- the prefix the R2 lifecycle rule
    # expires unconfirmed uploads out of (see storage.py).
    assert body["storage_key"].startswith(f"course-photos/pending/{course_id}/")
    assert body["content_type"] == "image/jpeg"


def test_confirm_creates_pending_user_image() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/photo.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": storage_key, "width": 1600, "height": 1200},
        headers=HEADERS,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_type"] == "user"
    assert body["width"] == 1600
    assert body["height"] == 1200


def test_confirm_promotes_object_to_its_permanent_key() -> None:
    """confirm_upload must copy the validated object out of
    course-photos/pending/ to its permanent key before persisting the row --
    a row must never point at a key with nothing there, and a live photo
    must never be subject to the pending prefix's expiry."""
    storage = FakeObjectStorage()
    client = _client(object_storage=storage, course_image_base_url="https://cdn.example/assets")
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/photo.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )

    assert response.status_code == 201
    permanent_key = promote_storage_key(storage_key)
    assert not permanent_key.startswith("course-photos/pending/")
    assert response.json()["url"] == f"https://cdn.example/assets/{permanent_key}"
    assert permanent_key in storage.objects


def test_confirm_cleans_up_the_promoted_object_when_persisting_the_row_fails(monkeypatch) -> None:
    """If add_user_image fails after the object has already been promoted to
    its permanent key (an exhausted retry, a DB outage), that object is
    outside course-photos/pending/'s lifecycle rule -- nothing would ever
    reclaim it unless confirm_upload cleans it up itself when persistence
    fails."""
    import app.course_photo_uploads as course_photo_uploads_module

    storage = FakeObjectStorage()
    client = _client(object_storage=storage, course_image_base_url="https://cdn.example/assets")
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/photo.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    def raise_error(*args, **kwargs):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(course_photo_uploads_module._repository, "add_user_image", raise_error)

    permanent_key = promote_storage_key(storage_key)
    with pytest.raises(RuntimeError):
        client.post(
            f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
        )

    assert permanent_key in storage.deleted
    assert permanent_key not in storage.objects


def test_confirm_rejects_missing_object() -> None:
    client = _client(object_storage=FakeObjectStorage())
    course_id = _pebble_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": f"course-photos/pending/{course_id}/missing.jpg"},
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_confirm_rejects_and_deletes_oversized_object() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/huge.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=50_000_000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )

    assert response.status_code == 422
    assert storage_key in storage.deleted


def test_confirm_rejects_cross_course_storage_key() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    other_key = f"course-photos/pending/{course_id + 1}/photo.jpg"
    storage.objects[other_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": other_key}, headers=HEADERS,
    )

    assert response.status_code == 400


def test_confirm_rejects_unknown_fields() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/photo.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": storage_key, "moderation_status": "approved"},
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_confirmed_upload_appears_in_gallery_but_not_as_hero_while_pending() -> None:
    """Moderation gates hero-image eligibility only -- a PENDING upload shows in
    the course's photo gallery immediately, but resolve_hero_image ignores it."""
    storage = FakeObjectStorage()
    client = _client(object_storage=storage, course_image_base_url="https://cdn.example/assets")
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/photo.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    confirm = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )
    image_id = confirm.json()["id"]

    detail = client.get(f"/api/v1/courses/{course_id}")
    assert any(image["id"] == image_id for image in detail.json()["images"])
    assert detail.json()["hero_image"]["type"] != "USER"


def _rated_round_id(client: TestClient, course_id: int, headers: dict[str, str]) -> int:
    response = client.put(
        f"/api/v1/me/course-ratings/{course_id}", headers=headers,
        json={"tier": "green", "played_on": "2026-07-01", "score": 80},
    )
    assert response.status_code == 200
    return response.json()["round"]["id"]


def test_confirm_links_round_id_and_appears_on_feed_regardless_of_moderation() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage, course_image_base_url="https://cdn.example/assets")
    course_id = _pebble_id(client)
    round_id = _rated_round_id(client, course_id, HEADERS)
    storage_key = f"course-photos/pending/{course_id}/round.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    confirm = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": storage_key, "round_id": round_id},
        headers=HEADERS,
    )

    assert confirm.status_code == 201
    body = confirm.json()
    assert body["round_id"] == round_id
    assert body["is_hero"] is False  # still PENDING, so ineligible as hero

    state = client.get(f"/api/v1/me/course-ratings/{course_id}", headers=HEADERS).json()
    assert [photo["id"] for photo in state["round"]["photos"]] == [body["id"]]

    # Moderation gates hero eligibility only -- the pending photo is still
    # visible in the course's own gallery.
    detail = client.get(f"/api/v1/courses/{course_id}")
    assert any(image["id"] == body["id"] for image in detail.json()["images"])


def test_confirm_rejects_round_id_belonging_to_another_user() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    other_headers = {"X-Development-Subject": "dev:other-rater"}
    other_round_id = _rated_round_id(client, course_id, other_headers)
    storage_key = f"course-photos/pending/{course_id}/round.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": storage_key, "round_id": other_round_id},
        headers=HEADERS,
    )

    assert response.status_code == 400
    assert storage_key in storage.deleted


def test_discard_deletes_unconfirmed_object() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/abandoned.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/discard", json={"storage_key": storage_key}, headers=HEADERS,
    )

    assert response.status_code == 204
    assert storage_key in storage.deleted
    assert storage_key not in storage.objects


def test_discard_requires_auth() -> None:
    client = _client(object_storage=FakeObjectStorage())
    course_id = _pebble_id(client)

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/discard",
        json={"storage_key": f"course-photos/pending/{course_id}/abandoned.jpg"},
    )

    assert response.status_code == 401


def test_discard_rejects_cross_course_storage_key() -> None:
    client = _client(object_storage=FakeObjectStorage())
    course_id = _pebble_id(client)
    other_key = f"course-photos/pending/{course_id + 1}/abandoned.jpg"

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/discard", json={"storage_key": other_key}, headers=HEADERS,
    )

    assert response.status_code == 400


def test_discard_refuses_already_confirmed_storage_key() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/confirmed.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)
    confirm = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )
    assert confirm.status_code == 201

    response = client.post(
        f"/api/v1/courses/{course_id}/photos/discard", json={"storage_key": storage_key}, headers=HEADERS,
    )

    assert response.status_code == 409
    assert storage_key not in storage.deleted


def test_confirm_enforces_photo_cap_per_round() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    round_id = _rated_round_id(client, course_id, HEADERS)

    for index in range(5):
        storage_key = f"course-photos/pending/{course_id}/round-{index}.jpg"
        storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)
        response = client.post(
            f"/api/v1/courses/{course_id}/photos/confirm",
            json={"storage_key": storage_key, "round_id": round_id},
            headers=HEADERS,
        )
        assert response.status_code == 201

    overflow_key = f"course-photos/pending/{course_id}/round-overflow.jpg"
    storage.objects[overflow_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)
    response = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": overflow_key, "round_id": round_id},
        headers=HEADERS,
    )

    assert response.status_code == 422
    assert overflow_key in storage.deleted


def test_confirm_replay_is_idempotent_and_does_not_consume_extra_round_slot() -> None:
    """Replaying a confirm for an already-confirmed storage_key must return the
    existing row rather than create a duplicate gallery entry or consume
    another round-photo slot (uq_course_image_user_storage_key)."""
    storage = FakeObjectStorage()
    client = _client(object_storage=storage, course_image_base_url="https://cdn.example/assets")
    course_id = _pebble_id(client)
    round_id = _rated_round_id(client, course_id, HEADERS)
    storage_key = f"course-photos/pending/{course_id}/round.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    first = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": storage_key, "round_id": round_id},
        headers=HEADERS,
    )
    second = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm",
        json={"storage_key": storage_key, "round_id": round_id},
        headers=HEADERS,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    state = client.get(f"/api/v1/me/course-ratings/{course_id}", headers=HEADERS).json()
    assert len(state["round"]["photos"]) == 1

    # Four more distinct uploads should still fit under the five-photo cap --
    # the replay above must not have consumed a slot.
    for index in range(4):
        extra_key = f"course-photos/pending/{course_id}/round-extra-{index}.jpg"
        storage.objects[extra_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)
        response = client.post(
            f"/api/v1/courses/{course_id}/photos/confirm",
            json={"storage_key": extra_key, "round_id": round_id},
            headers=HEADERS,
        )
        assert response.status_code == 201


def test_confirm_replay_is_idempotent_even_after_the_pending_object_expired() -> None:
    """The idempotency check must be keyed on the deterministic permanent key
    and run before any storage I/O -- a replayed confirm must still succeed
    even if the pending copy has since aged out of R2 via the
    course-photos/pending/ lifecycle rule."""
    storage = FakeObjectStorage()
    client = _client(object_storage=storage, course_image_base_url="https://cdn.example/assets")
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/round.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    first = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )
    assert first.status_code == 201

    # Simulate the pending copy having expired out of R2.
    storage.objects.pop(storage_key, None)

    second = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]


def test_confirm_rejects_replay_from_a_different_user() -> None:
    storage = FakeObjectStorage()
    client = _client(object_storage=storage)
    course_id = _pebble_id(client)
    storage_key = f"course-photos/pending/{course_id}/photo.jpg"
    storage.objects[storage_key] = ObjectMeta(content_type="image/jpeg", content_length=5000)

    first = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=HEADERS,
    )
    assert first.status_code == 201

    other_headers = {"X-Development-Subject": "dev:someone-else"}
    second = client.post(
        f"/api/v1/courses/{course_id}/photos/confirm", json={"storage_key": storage_key}, headers=other_headers,
    )
    assert second.status_code == 403
