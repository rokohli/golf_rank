from botocore.exceptions import EndpointConnectionError

from app.storage import R2ObjectStorage


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
