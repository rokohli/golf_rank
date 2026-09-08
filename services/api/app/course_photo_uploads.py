"""User-submitted course photo upload endpoints.

Upload goes straight from the client to R2 via a presigned PUT -- file bytes
never pass through this API process. See storage.py for the R2-specific
pieces; this module only orchestrates auth, validation, and persistence.

Uploaded rows always land as CourseImageSource.USER / CourseImageModeration.PENDING
-- moderation (approving/rejecting/featuring) is a separate, not-yet-built slice
that governs ONLY hero-image eligibility (resolve_hero_image, via
CourseImageRepository.approved_images, ignores non-APPROVED rows). A pending
upload is immediately visible in the course's photo gallery (course_image_data
does not filter on moderation_status) and, when uploaded with a round_id, on
that round's feed posting too (domain.round_image_data) -- moderation never
gates plain visibility, only whether a photo can become the course's hero image.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.rate_limit import photo_upload_rate_limit
from .course_images.repository import CourseImageRepository
from .db import get_session
from .domain import require_course, require_user, storage_image_url, uploader_username
from .models import Round
from .schemas import CourseImageOut, CoursePhotoConfirmRequest, CoursePhotoUploadRequest, CoursePhotoUploadResponse
from .storage import ObjectStorage

router = APIRouter(tags=["course-photo-uploads"])
_repository = CourseImageRepository()

# Keeps storage/moderation load bounded for photos attached to a single round posting.
MAX_PHOTOS_PER_ROUND = 5


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
    dependencies=[Depends(photo_upload_rate_limit)],
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
    if not payload.storage_key.startswith(f"course-photos/{course.id}/"):
        raise HTTPException(400, "storage_key does not match course")

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
        if _repository.count_for_round(session, round_.id) >= MAX_PHOTOS_PER_ROUND:
            storage.delete_object(payload.storage_key)
            raise HTTPException(422, f"A round can have at most {MAX_PHOTOS_PER_ROUND} photos")

    image = _repository.add_user_image(
        session, course.id,
        storage_key=payload.storage_key,
        uploaded_by_user_id=user.id,
        alt_text=f"User-submitted photo of {course.name}",
        width=payload.width,
        height=payload.height,
        round_id=payload.round_id,
    )
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
