"""R2 (S3-compatible) object storage for user-uploaded course photos.

All boto3/S3-specific code lives exclusively here -- nowhere else in the app
should construct a presigned URL, call HeadObject/DeleteObject, or know R2's
endpoint shape.

This module only ever builds a presigned PUT for the client to upload
directly to R2, and later HEADs the resulting object to verify it landed --
file bytes never pass through our API process.

Uses presigned PUT, not presigned POST: R2 does not implement S3's presigned
POST policy-document flow at all (confirmed against live R2 -- it returns
"NotImplemented: Presigned post requests are not yet implemented"). That
means R2 has no storage-side way to enforce a content-length-range before the
object lands, unlike AWS S3. Content-Type is still enforced -- it's part of
the signed URL, so a mismatched header fails the signature -- but size can
only be checked after the fact via head_object at confirm time. See
delete_object: the confirm endpoint uses it to clean up an object that fails
that after-the-fact size/type check, since nothing stopped an oversized file
from reaching R2 in the first place.

KNOWN LIMITATION -- unconfirmed uploads are not size-bounded. Because R2
can't reject an oversized PUT before it lands, a client can request a
presigned URL, upload an arbitrarily large object straight to R2, and simply
never call /photos/confirm. No CourseImage row is ever created, so nothing
in the app (discard, round/account deletion) ever learns the object exists
to clean it up -- it can sit in the bucket indefinitely. The existing
photo_upload_rate_limit only bounds how many presigned URLs a user can
request per day; it does not bound the size of what they then PUT with one.
Two ways to actually close this (not just delay it -- a background reaper
that deletes old orphaned objects only bounds how long an oversized object
survives, not whether the PUT itself succeeds, since by the time anything in
this app can see the object, its bytes are already fully stored):
  1. Stop using direct-to-R2 presigned PUT for this upload path; route it
     through the API instead, so the server can reject on Content-Length (or
     abort a stream) before the bytes reach R2. This gives up the "file
     bytes never pass through our API process" property above -- it adds a
     hop and moves the transfer through a single-region API host instead of
     R2's edge.
  2. Put a size-checking gate in front of the bucket, e.g. a Cloudflare
     Worker bound to it that inspects Content-Length and rejects an
     oversized PUT before R2 accepts it. Keeps the direct-upload
     architecture, but is new infrastructure this repo doesn't have today
     (no wrangler/Workers setup) -- a separate deployable to write, deploy,
     and maintain.
Neither has been implemented; this is an accepted risk for now.
"""

from dataclasses import dataclass
from typing import Protocol
import uuid

import boto3
from botocore.exceptions import BotoCoreError, ClientError

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_EXT_BY_CONTENT_TYPE = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


@dataclass(frozen=True)
class PresignedUpload:
    url: str
    storage_key: str


@dataclass(frozen=True)
class ObjectMeta:
    content_type: str
    content_length: int


class ObjectStorage(Protocol):
    """The abstraction the rest of the app depends on -- never a boto3 client directly."""

    def create_course_photo_upload(
        self, *, course_id: int, content_type: str, expires_in_seconds: int,
    ) -> PresignedUpload | None: ...

    def head_object(self, storage_key: str) -> ObjectMeta | None: ...

    def delete_object(self, storage_key: str) -> None: ...


def build_storage_key(course_id: int, content_type: str) -> str:
    """Server-generated key -- never derived from client input. Prevents path
    traversal/collisions; the presigned URL is scoped to this exact key."""
    ext = _EXT_BY_CONTENT_TYPE[content_type]
    return f"course-photos/{course_id}/{uuid.uuid4()}.{ext}"


class R2ObjectStorage:
    def __init__(self, *, account_id: str, access_key_id: str, secret_access_key: str, bucket_name: str):
        self._bucket = bucket_name
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
        )

    def create_course_photo_upload(
        self, *, course_id: int, content_type: str, expires_in_seconds: int,
    ) -> PresignedUpload | None:
        if content_type not in ALLOWED_CONTENT_TYPES:
            return None
        storage_key = build_storage_key(course_id, content_type)
        url = self._client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self._bucket, "Key": storage_key, "ContentType": content_type},
            ExpiresIn=expires_in_seconds,
        )
        return PresignedUpload(url=url, storage_key=storage_key)

    def head_object(self, storage_key: str) -> ObjectMeta | None:
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=storage_key)
        except ClientError:
            return None
        return ObjectMeta(
            content_type=response.get("ContentType", ""),
            content_length=int(response.get("ContentLength", 0)),
        )

    def delete_object(self, storage_key: str) -> None:
        # Best-effort: callers use this for cleanup after their own primary
        # operation (a DB commit, a rejected upload) has already succeeded --
        # a storage failure here must never propagate and abort that already-
        # -completed work. Catches BotoCoreError too, not just ClientError:
        # a transport failure (e.g. R2 unreachable) raises BotoCoreError
        # subclasses like EndpointConnectionError, which ClientError alone
        # would let escape.
        try:
            self._client.delete_object(Bucket=self._bucket, Key=storage_key)
        except (ClientError, BotoCoreError):
            pass


def build_object_storage(settings) -> ObjectStorage | None:
    """Returns None if R2 isn't fully configured -- callers must treat that as
    a 503, never silently skip validation. course_image_base_url counts as
    part of "configured": without it, storage_image_url() can't build a
    servable URL, so confirm_upload would still succeed, consume a round
    slot, and return url: null forever -- a photo nobody can ever see."""
    if not all([
        settings.r2_account_id, settings.r2_access_key_id, settings.r2_secret_access_key,
        settings.r2_bucket_name, settings.course_image_base_url,
    ]):
        return None
    return R2ObjectStorage(
        account_id=settings.r2_account_id,
        access_key_id=settings.r2_access_key_id,
        secret_access_key=settings.r2_secret_access_key,
        bucket_name=settings.r2_bucket_name,
    )
