"""User-submitted course photo upload endpoints.

Upload goes straight from the client to R2 via a presigned PUT -- file bytes
never pass through this API process. See storage.py for the R2-specific
pieces; this module only orchestrates auth, validation, and persistence.

Uploaded rows always land as CourseImageSource.USER / CourseImageModeration.PENDING
-- moderation (approving/rejecting/featuring) lives in course_photo_moderation.py
and governs ONLY hero-image eligibility (resolve_hero_image, via
CourseImageRepository.approved_images, ignores non-APPROVED rows). A pending
upload is immediately visible in the course's photo gallery (course_image_data
does not filter on moderation_status) and, when uploaded with a round_id, on
that round's feed posting too (domain.round_image_data) -- moderation never
gates plain visibility, only whether a photo can become the course's hero image.
That holds for REJECTED as well: rejecting means "never eligible to be the
hero", not "hidden". Removing a photo from view is DELETE
/api/v1/admin/course-photos/{id}, which deletes the row and the R2 object.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.rate_limit import photo_confirm_rate_limit, photo_discard_rate_limit, photo_upload_rate_limit
from .course_images.repository import CourseImageRepository
from .db import get_session
from .domain import delete_permanent_objects, require_course, require_user, storage_image_url, uploader_username
from .models import CourseImage, Round
from .schemas import (
    CourseImageOut,
    CoursePhotoConfirmRequest,
    CoursePhotoDiscardRequest,
    CoursePhotoUploadRequest,
    CoursePhotoUploadResponse,
)
from .storage import ObjectStorage, promote_storage_key

router = APIRouter(tags=["course-photo-uploads"])
_repository = CourseImageRepository()

# Keeps storage/moderation load bounded for photos attached to a single round posting.
MAX_PHOTOS_PER_ROUND = 5


def image_out(session: Session, settings, image: CourseImage) -> CourseImageOut:
    """The public per-photo shape. Shared with course_photo_moderation, which
    nests it inside its admin payload rather than duplicating these fields."""
    return CourseImageOut(
        id=image.id,
        url=storage_image_url(settings.course_image_base_url, image.storage_key),
        alt_text=image.alt_text,
        source_name=None,
        source_url=None,
        license_name=None,
        license_url=None,
        position=image.position,
        is_hero=image.is_hero,
        source_type=image.source_type,
        quality_score=image.quality_score,
        width=image.width,
        height=image.height,
        created_at=image.created_at.isoformat() if image.created_at else None,
        uploaded_by_username=uploader_username(session, image.uploaded_by_user_id),
        round_id=image.round_id,
    )


def _object_storage(request: Request) -> ObjectStorage:
    storage = getattr(request.app.state, "object_storage", None)
    if storage is None:
        raise HTTPException(503, "Photo uploads are temporarily unavailable")
    return storage


@router.post(
    "/api/v1/courses/{course_id}/photos/upload-url",
    response_model=CoursePhotoUploadResponse,
    status_code=201,
    dependencies=[Depends(photo_upload_rate_limit)],
)
def create_upload_url(
    course_id: int,
    payload: CoursePhotoUploadRequest,
    request: Request,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> CoursePhotoUploadResponse:
    require_user(session, current, create=True)
    course = require_course(session, course_id)
    settings = request.app.state.settings
    storage = _object_storage(request)
    presigned = storage.create_course_photo_upload(
        course_id=course.id,
        content_type=payload.content_type,
        expires_in_seconds=settings.course_photo_upload_url_ttl_seconds,
    )
    if presigned is None:
        raise HTTPException(400, "Unsupported content type")
    return CoursePhotoUploadResponse(
        upload_url=presigned.url,
        storage_key=presigned.storage_key,
        content_type=payload.content_type,
        expires_in_seconds=settings.course_photo_upload_url_ttl_seconds,
    )


@router.post(
    "/api/v1/courses/{course_id}/photos/confirm",
    response_model=CourseImageOut,
    status_code=201,
    # Deliberately a separate rate-limit bucket from upload-url/discard --
    # see photo_confirm_rate_limit's docstring: uploading one photo costs one
    # call against each endpoint, so sharing a bucket meant each photo spent
    # two units of a budget sized for one.
    dependencies=[Depends(photo_confirm_rate_limit)],
)
def confirm_upload(
    course_id: int,
    payload: CoursePhotoConfirmRequest,
    request: Request,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> CourseImageOut:
    user = require_user(session, current, create=True)
    course = require_course(session, course_id)
    settings = request.app.state.settings
    storage = _object_storage(request)

    # Path-scoping check: storage_key must belong to this course, even though it's
    # server-generated -- defends against confirming a key issued for a different course_id.
    if not payload.storage_key.startswith(f"course-photos/pending/{course.id}/"):
        raise HTTPException(400, "storage_key does not match course")

    # Idempotent replay, checked before any storage I/O and keyed on the
    # would-be permanent key (not the pending one the client sent): a
    # replayed confirm for an already-promoted upload must stay idempotent
    # even after its pending copy has expired out of R2 (see
    # storage.py's course-photos/pending/ lifecycle rule and
    # promote_storage_key's docstring). Also means a replay never re-runs
    # the round-cap check below, so it can't consume another slot.
    permanent_key = promote_storage_key(payload.storage_key)
    existing = _repository.find_by_storage_key(session, permanent_key)
    if existing is not None:
        if existing.uploaded_by_user_id != user.id:
            raise HTTPException(403, "storage_key belongs to another user")
        return image_out(session, settings, existing)

    meta = storage.head_object(payload.storage_key)
    if meta is None:
        raise HTTPException(422, "Uploaded object not found")
    # R2 has no presigned-POST/policy mechanism to reject an out-of-range or
    # mistyped object before it lands (see storage.py's module docstring), so
    # this is the first point size/type can be checked -- clean up the object
    # on rejection rather than leaving it in the bucket forever.
    if meta.content_type not in ("image/jpeg", "image/png", "image/webp"):
        storage.delete_object(payload.storage_key)
        raise HTTPException(422, "Uploaded object has an unsupported content type")
    if not (settings.course_photo_min_bytes <= meta.content_length <= settings.course_photo_max_bytes):
        storage.delete_object(payload.storage_key)
        raise HTTPException(422, "Uploaded object size is out of range")

    if payload.round_id is not None:
        round_ = session.get(Round, payload.round_id)
        if round_ is None or round_.user_id != user.id or round_.course_id != course.id:
            storage.delete_object(payload.storage_key)
            raise HTTPException(400, "round_id does not match this course or user")
        # Locks the round row so two concurrent confirms for it can't both read
        # the same count-under-cap before either commits its insert (the count
        # check below would otherwise race: see count_for_round's caller here).
        session.execute(select(Round).where(Round.id == round_.id).with_for_update())
        if _repository.count_for_round(session, round_.id) >= MAX_PHOTOS_PER_ROUND:
            storage.delete_object(payload.storage_key)
            raise HTTPException(422, f"A round can have at most {MAX_PHOTOS_PER_ROUND} photos")

    # Promotes the validated object out of course-photos/pending/ to its
    # permanent key before persisting the row -- a row must never point at a
    # key with nothing there. Left un-caught: a failure here (network,
    # transient R2 error) surfaces as a 5xx, which the client now treats as
    # retryable rather than a permanent rejection (see RatingFlow.tsx's
    # isRetryableConfirmFailure) -- correct, since the pending object is
    # still there to retry against.
    storage.promote_object(payload.storage_key, permanent_key)

    try:
        image = _repository.add_user_image(
            session, course.id,
            storage_key=permanent_key,
            uploaded_by_user_id=user.id,
            alt_text=f"User-submitted photo of {course.name}",
            width=payload.width,
            height=payload.height,
            round_id=payload.round_id,
        )
    except Exception:
        # The object is already promoted to its permanent key above, outside
        # course-photos/pending/'s lifecycle rule -- if persisting the row
        # then fails (exhausted retries, a DB outage), that object would
        # otherwise be orphaned forever with nothing left to reclaim it.
        # Clean it up (or durably record the failure for retry) before
        # letting the original error propagate. The pending copy is
        # untouched, so a client retry of this same confirm call still
        # works from scratch.
        delete_permanent_objects(session, storage, [permanent_key], context="confirm_persist_failed")
        raise
    return image_out(session, settings, image)


@router.post(
    "/api/v1/courses/{course_id}/photos/discard",
    status_code=204,
    # Deliberately a separate rate-limit bucket from upload-url -- see
    # photo_discard_rate_limit's docstring: discard is best-effort cleanup
    # the client never retries on failure, so sharing upload-url's bucket
    # meant it could be denied by the very requests it exists to clean up
    # after.
    dependencies=[Depends(photo_discard_rate_limit)],
)
def discard_upload(
    course_id: int,
    payload: CoursePhotoDiscardRequest,
    request: Request,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> None:
    """Cleans up an R2 object a client uploaded but decided not to keep --
    e.g. the user removed the staged photo before Continue confirmed it.
    Only ever deletes the raw object: a storage_key that's already backed by
    a CourseImage row is a confirmed, published photo and must go through
    DELETE /api/v1/admin/course-photos/{id} instead, never this one."""
    require_user(session, current, create=True)
    require_course(session, course_id)
    storage = _object_storage(request)

    if not payload.storage_key.startswith(f"course-photos/pending/{course_id}/"):
        raise HTTPException(400, "storage_key does not match course")
    # A confirmed row's storage_key is the promoted, permanent key -- never
    # the pending one this endpoint only ever receives -- so "already
    # confirmed" has to check the would-be permanent key, not payload.storage_key directly.
    permanent_key = promote_storage_key(payload.storage_key)
    if session.scalar(select(CourseImage).where(CourseImage.storage_key == permanent_key)) is not None:
        raise HTTPException(409, "storage_key is already confirmed")

    storage.delete_object(payload.storage_key)
