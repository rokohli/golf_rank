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

KNOWN LIMITATION -- unconfirmed uploads are not size-bounded at upload time.
Because R2 can't reject an oversized PUT before it lands, a client can
request a presigned URL and upload an arbitrarily large object straight to
R2 before confirm_upload ever gets a chance to reject it on size. What IS
bounded now is how long such an object can survive: every upload lands under
the course-photos/pending/ prefix (see build_storage_key), which carries an
R2 bucket lifecycle rule expiring objects after 24 hours (see
scripts/apply_r2_lifecycle_rule.py, and set_up_course_photo_lifecycle_rule
below for what it configures). confirm_upload promotes a validated object to
its permanent, unprefixed key (promote_storage_key) -- objects that are
never confirmed, or are rejected and left behind, just age out on their own.
This bounds the retained blast radius but not the initial oversized PUT
itself; closing that still means one of:
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
Neither has been implemented; this remains an accepted risk.
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

    def delete_object(self, storage_key: str) -> bool: ...

    def promote_object(self, pending_key: str, permanent_key: str) -> None: ...


_PENDING_PREFIX = "course-photos/pending/"


def build_storage_key(course_id: int, content_type: str) -> str:
    """Server-generated key -- never derived from client input. Prevents path
    traversal/collisions; the presigned URL is scoped to this exact key.

    Lands under course-photos/pending/, not course-photos/ directly: that
    prefix carries an R2 lifecycle rule expiring objects after 24 hours (see
    this module's docstring), so an upload nobody ever confirms or discards
    just ages out instead of sitting in the bucket forever. confirm_upload
    promotes a validated upload out of this prefix -- see promote_storage_key
    -- so a live, displayed photo is never subject to that expiry."""
    ext = _EXT_BY_CONTENT_TYPE[content_type]
    return f"{_PENDING_PREFIX}{course_id}/{uuid.uuid4()}.{ext}"


def promote_storage_key(pending_key: str) -> str:
    """The permanent key a validated pending upload is copied to on confirm --
    same course_id/filename, just outside course-photos/pending/'s lifecycle
    rule. Deterministic (not a new random key) so confirm_upload can check
    for an existing row keyed on the *would-be* permanent key before ever
    touching storage: a replayed confirm for an already-promoted upload must
    stay idempotent even after the pending copy has expired out of R2."""
    if not pending_key.startswith(_PENDING_PREFIX):
        raise ValueError(f"not a pending storage_key: {pending_key!r}")
    return f"course-photos/{pending_key.removeprefix(_PENDING_PREFIX)}"


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
        except ClientError as error:
            # HeadObject has no response body, so S3/R2 report a genuine
            # "not found" as Error.Code "404" (not "NoSuchKey", which only
            # ever appears on GetObject) -- that, and only that, means the
            # object really isn't there. Every other ClientError (throttling,
            # a temporary 5xx, expired credentials, access denied) is an
            # operational failure, not an absent object, and must propagate:
            # confirm_upload treats a None here as a definitive 422
            # rejection, but the client's retry classifier only treats a 5xx
            # as retryable -- collapsing an operational failure into the
            # same None as "not found" would misclassify it as permanent.
            code = error.response.get("Error", {}).get("Code")
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey") or status == 404:
                return None
            raise
        return ObjectMeta(
            content_type=response.get("ContentType", ""),
            content_length=int(response.get("ContentLength", 0)),
        )

    def delete_object(self, storage_key: str) -> bool:
        # Never raises: callers use this for cleanup after their own primary
        # operation (a DB commit, a rejected upload) has already succeeded --
        # a storage failure here must never propagate and abort that already-
        # -completed work. Catches BotoCoreError too, not just ClientError:
        # a transport failure (e.g. R2 unreachable) raises BotoCoreError
        # subclasses like EndpointConnectionError, which ClientError alone
        # would let escape. Returns whether it actually succeeded, though --
        # unlike a pending-prefixed key (which the lifecycle rule reclaims
        # regardless), a permanent key has no other backstop, so a caller
        # deleting one (round/account deletion) needs to know to record the
        # failure for retry rather than silently losing it forever.
        try:
            self._client.delete_object(Bucket=self._bucket, Key=storage_key)
            return True
        except (ClientError, BotoCoreError):
            return False

    def promote_object(self, pending_key: str, permanent_key: str) -> None:
        # Not best-effort: confirm_upload only creates the CourseImage row
        # after this succeeds, since the row's storage_key points at
        # permanent_key -- a failure here must propagate so the caller
        # doesn't persist a row with nothing at its key. The pending copy is
        # deliberately left in place rather than deleted: it's harmless (the
        # lifecycle rule reclaims it) and deleting it here would just be
        # another place a failure could leak an object for no benefit -- the
        # permanent copy is what's served from now on either way.
        self._client.copy_object(
            Bucket=self._bucket,
            CopySource={"Bucket": self._bucket, "Key": pending_key},
            Key=permanent_key,
        )


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
