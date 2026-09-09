import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.core.config import Settings
from app.storage import R2ObjectStorage, build_object_storage, build_storage_key, promote_storage_key


class _RaisingClient:
    def delete_object(self, **kwargs):
        raise EndpointConnectionError(endpoint_url="https://r2.example/unreachable")


def test_delete_object_swallows_transport_failures() -> None:
    """delete_object is used as best-effort cleanup after the caller's own
    primary operation (a round/account deletion commit, a rejected upload)
    has already succeeded -- a network-level failure reaching R2 (raised as
    BotoCoreError, e.g. EndpointConnectionError, not ClientError) must not
    propagate and interrupt that caller."""
    storage = R2ObjectStorage(
        account_id="test", access_key_id="test", secret_access_key="test", bucket_name="test-bucket",
    )
    storage._client = _RaisingClient()

    storage.delete_object("course-photos/1/photo.jpg")


class _HeadObjectErrorClient:
    def __init__(self, error: ClientError) -> None:
        self._error = error

    def head_object(self, **kwargs):
        raise self._error


def _client_error(code: str, status: int) -> ClientError:
    return ClientError(
        {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "HeadObject",
    )


def test_head_object_treats_only_404_as_not_found() -> None:
    storage = R2ObjectStorage(
        account_id="test", access_key_id="test", secret_access_key="test", bucket_name="test-bucket",
    )
    storage._client = _HeadObjectErrorClient(_client_error("404", 404))

    assert storage.head_object("course-photos/pending/1/x.jpg") is None


def test_head_object_propagates_operational_failures() -> None:
    """A throttling, temporary-5xx, expired-credentials, or access-denied
    ClientError from HeadObject is not "the object doesn't exist" -- treating
    it as None makes confirm_upload respond with a definitive 422 rejection,
    which the client's retry classifier (isRetryableConfirmFailure) treats
    as permanent and drops the staged photo, when the object may well still
    be there and the failure was purely operational."""
    storage = R2ObjectStorage(
        account_id="test", access_key_id="test", secret_access_key="test", bucket_name="test-bucket",
    )
    storage._client = _HeadObjectErrorClient(_client_error("SlowDown", 503))

    with pytest.raises(ClientError):
        storage.head_object("course-photos/pending/1/x.jpg")


_R2_CREDS = {
    "r2_account_id": "acct", "r2_access_key_id": "key", "r2_secret_access_key": "secret",
    "r2_bucket_name": "bucket",
}


def test_build_object_storage_requires_a_serving_base_url() -> None:
    """R2 credentials alone aren't "configured": without course_image_base_url,
    storage_image_url() can never build a servable URL, so confirm_upload
    would still succeed, consume a round slot, and return url: null forever
    -- a photo nobody can ever see. Uploads must stay disabled (503) until
    the base URL is set too."""
    settings = Settings(**_R2_CREDS, course_image_base_url=None)
    assert build_object_storage(settings) is None


def test_build_object_storage_enabled_once_base_url_is_set() -> None:
    settings = Settings(**_R2_CREDS, course_image_base_url="https://cdn.example/assets")
    assert build_object_storage(settings) is not None


def test_build_storage_key_lands_under_the_pending_prefix() -> None:
    """The R2 bucket lifecycle rule (see apply_r2_lifecycle_rule.py) only
    expires objects under course-photos/pending/ -- an upload must land
    there so it ages out if never confirmed or discarded."""
    key = build_storage_key(7, "image/jpeg")
    assert key.startswith("course-photos/pending/7/")
    assert key.endswith(".jpg")


def test_promote_storage_key_strips_only_the_pending_segment() -> None:
    permanent = promote_storage_key("course-photos/pending/7/abc-123.jpg")
    assert permanent == "course-photos/7/abc-123.jpg"


def test_promote_storage_key_rejects_a_non_pending_key() -> None:
    with pytest.raises(ValueError):
        promote_storage_key("course-photos/7/already-permanent.jpg")


class _CopyingClient:
    def __init__(self) -> None:
        self.copy_calls: list[dict] = []

    def copy_object(self, **kwargs):
        self.copy_calls.append(kwargs)


def test_promote_object_copies_pending_to_permanent_key() -> None:
    storage = R2ObjectStorage(
        account_id="test", access_key_id="test", secret_access_key="test", bucket_name="test-bucket",
    )
    client = _CopyingClient()
    storage._client = client

    storage.promote_object("course-photos/pending/7/abc.jpg", "course-photos/7/abc.jpg")

    assert client.copy_calls == [{
        "Bucket": "test-bucket",
        "CopySource": {"Bucket": "test-bucket", "Key": "course-photos/pending/7/abc.jpg"},
        "Key": "course-photos/7/abc.jpg",
    }]


class _FailingCopyClient:
    def copy_object(self, **kwargs):
        raise EndpointConnectionError(endpoint_url="https://r2.example/unreachable")


def test_promote_object_failure_is_not_swallowed() -> None:
    """Unlike delete_object, a promote_object failure must propagate: the
    caller (confirm_upload) only creates the CourseImage row after this
    succeeds, since the row's storage_key points at the permanent key --
    silently swallowing a copy failure would persist a row with nothing at
    its key."""
    storage = R2ObjectStorage(
        account_id="test", access_key_id="test", secret_access_key="test", bucket_name="test-bucket",
    )
    storage._client = _FailingCopyClient()

    with pytest.raises(EndpointConnectionError):
        storage.promote_object("course-photos/pending/7/abc.jpg", "course-photos/7/abc.jpg")
