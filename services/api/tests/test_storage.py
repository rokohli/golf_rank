from botocore.exceptions import EndpointConnectionError

from app.core.config import Settings
from app.storage import R2ObjectStorage, build_object_storage


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
