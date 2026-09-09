"""Admin moderation of user-submitted course photos.

SCOPE -- moderation governs hero-image eligibility, not visibility. A PENDING
photo is already visible in the course gallery (domain.course_image_data) and
on its round's feed posting (domain.round_image_data); approving it only makes
it eligible to win its tier in CourseImageService._resolve. Rejecting likewise
does not hide anything: it means "never eligible to be the hero". The one
action that changes what anyone sees is DELETE, which removes the row and the
R2 object -- the flow course_photo_uploads.discard_upload defers to.

Every route here is admin-only (core/admin.require_admin) and answers 404 for a
non-admin, so the surface can't be enumerated with an ordinary token. Every
route is also scoped to source_type == USER: OFFICIAL and WIKIMEDIA rows are
curated by the offline scripts (scripts/refresh_course_photos.py,
scripts/score_course_photos.py) and must never be mutated from here.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.admin import require_admin
from .core.auth import CurrentUser
from .course_images.repository import CourseImageRepository
from .course_photo_uploads import image_out
from .db import get_session
from .domain import batch_uploader_usernames, delete_permanent_objects, require_user, uploader_username
from .models import Course, CourseImage, CourseImageModeration, CourseImageModerationAction
from .schemas import (
    AdminCoursePhotoOut,
    AdminCoursePhotoPage,
    CoursePhotoFeatureRequest,
    CoursePhotoRejectRequest,
)

router = APIRouter(prefix="/api/v1/admin/course-photos", tags=["course-photo-moderation"])
_repository = CourseImageRepository()

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 50

_STATUSES = {
    "pending": CourseImageModeration.PENDING,
    "approved": CourseImageModeration.APPROVED,
    "rejected": CourseImageModeration.REJECTED,
}


def _admin_photo_out(
    session: Session, settings, image: CourseImage, *,
    course_name: str, hero_locked: bool,
    uploader_username_val: str | None = None,
    moderator_username_val: str | None = None,
) -> AdminCoursePhotoOut:
    return AdminCoursePhotoOut(
        image=image_out(session, settings, image, uploaded_by_username=uploader_username_val),
        course_id=image.course_id,
        course_name=course_name,
        moderation_status=image.moderation_status,
        moderated_at=image.moderated_at.isoformat() if image.moderated_at else None,
        moderated_by_username=moderator_username_val,
        moderation_action=image.moderation_action,
        moderation_reason=image.moderation_reason,
        quality_score_reasons=image.quality_score_reasons,
        scored_at=image.scored_at.isoformat() if image.scored_at else None,
        scoring_attempts=image.scoring_attempts or 0,
        course_hero_locked=hero_locked,
    )


def _require_user_photo(session: Session, image_id: int) -> CourseImage:
    """Loads and locks one USER photo, or 404s.

    A row that exists but isn't USER-sourced 404s exactly like a missing one --
    the same status a non-admin gets, so no response distinguishes "no such
    photo" from "not yours to moderate".
    """
    image = _repository.lock_image_for_moderation(session, image_id)
    if image is None:
        raise HTTPException(404, "Not found")
    return image


def _single(session: Session, settings, image: CourseImage) -> AdminCoursePhotoOut:
    course = session.get(Course, image.course_id)
    return _admin_photo_out(
        session, settings, image,
        course_name=course.name if course else "",
        hero_locked=_repository.has_featured_hero(session, image.course_id),
        uploader_username_val=uploader_username(session, image.uploaded_by_user_id),
        moderator_username_val=uploader_username(session, image.moderated_by_user_id),
    )


@router.get("", response_model=AdminCoursePhotoPage)
def list_course_photos(
    request: Request,
    status: str = Query(default="pending"),
    course_id: int | None = Query(default=None),
    cursor: int | None = Query(default=None),
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    _admin: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> AdminCoursePhotoPage:
    if status not in _STATUSES:
        raise HTTPException(422, "status must be pending, approved, or rejected")
    settings = request.app.state.settings

    # One extra row tells us whether another page exists without a second query.
    rows = _repository.moderation_queue(
        session, status=_STATUSES[status], course_id=course_id,
        cursor=cursor, limit=limit + 1,
    )
    has_more = len(rows) > limit
    rows = rows[:limit]

    # Batch the per-page lookups rather than resolving them per row -- a queue
    # page spans many courses and uploaders. Batching bounds query count independently
    # of page size.
    course_ids = {image.course_id for image in rows}
    names = dict(session.execute(
        select(Course.id, Course.name).where(Course.id.in_(course_ids))
    ).all()) if course_ids else {}
    locked = _repository.batch_has_featured_hero(session, course_ids)

    user_ids = {img.uploaded_by_user_id for img in rows if img.uploaded_by_user_id is not None} | {
        img.moderated_by_user_id for img in rows if img.moderated_by_user_id is not None
    }
    usernames = batch_uploader_usernames(session, user_ids)

    return AdminCoursePhotoPage(
        items=[
            _admin_photo_out(
                session, settings, image,
                course_name=names.get(image.course_id, ""),
                hero_locked=image.course_id in locked,
                uploader_username_val=usernames.get(image.uploaded_by_user_id),
                moderator_username_val=usernames.get(image.moderated_by_user_id),
            )
            for image in rows
        ],
        next_cursor=rows[-1].id if has_more and rows else None,
    )


@router.post("/{image_id}/approve", response_model=AdminCoursePhotoOut)
def approve_course_photo(
    image_id: int,
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> AdminCoursePhotoOut:
    """Makes a photo eligible to win the USER tier. Idempotent.

    Deliberately does not touch is_hero: approval grants eligibility and lets
    _rank_key order the photo by quality_score, while is_hero is reserved for a
    human's explicit pick (see feature_course_photo). Auto-approval by the
    scorer relies on the same separation.
    """
    user = require_user(session, admin, create=True)
    image = _require_user_photo(session, image_id)
    _repository.set_moderation(
        session, image,
        status=CourseImageModeration.APPROVED,
        moderated_by_user_id=user.id,
        action=CourseImageModerationAction.APPROVED,
    )
    return _single(session, request.app.state.settings, image)


@router.post("/{image_id}/reject", response_model=AdminCoursePhotoOut)
def reject_course_photo(
    image_id: int,
    payload: CoursePhotoRejectRequest,
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> AdminCoursePhotoOut:
    """Marks a photo permanently ineligible to be the hero, and clears is_hero.

    Keeps both the row and the R2 object: rejection is reversible and, since
    moderation does not gate visibility, changes nothing a viewer sees. Use
    DELETE to actually remove a photo.
    """
    user = require_user(session, admin, create=True)
    image = _require_user_photo(session, image_id)
    _repository.set_moderation(
        session, image,
        status=CourseImageModeration.REJECTED,
        moderated_by_user_id=user.id,
        reason=payload.reason,
        action=CourseImageModerationAction.REJECTED,
    )
    return _single(session, request.app.state.settings, image)


@router.post("/{image_id}/feature", response_model=AdminCoursePhotoOut)
def feature_course_photo(
    image_id: int,
    payload: CoursePhotoFeatureRequest,
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> AdminCoursePhotoOut:
    """Pins (or unpins) this photo as the course's USER-tier hero.

    Featuring implies approving. Locks all tier rows deterministically
    before updating and commits atomically in one transaction to avoid deadlocks.
    """
    user = require_user(session, admin, create=True)
    image = _repository.feature_user_image(
        session, image_id, featured=payload.featured, moderator_user_id=user.id,
    )
    if image is None:
        raise HTTPException(404, "Not found")
    return _single(session, request.app.state.settings, image)


@router.delete("/{image_id}", status_code=204)
def delete_course_photo(
    image_id: int,
    request: Request,
    _admin: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> None:
    """Permanently removes a photo: the row, then the R2 object.

    Row first, then the object, matching main.delete_account and
    rounds.delete_round: delete_permanent_objects records a FailedObjectDeletion
    for any key R2 refuses, which scripts/retry_failed_object_deletions.py
    sweeps. Deliberately does not 503 when object storage is unconfigured --
    delete_permanent_objects handles storage=None by recording every key for
    retry, which is better than refusing to remove the row.

    The freed `position` value is not backfilled. Holes are harmless
    (next_position is max+1, not count), and renumbering would issue a burst of
    UPDATEs against uq_course_image_position concurrently with
    add_user_image's optimistic retry loop, turning a rare collision into a
    common one.
    """
    image = _require_user_photo(session, image_id)
    storage_key = image.storage_key
    _repository.delete_image(session, image)
    if storage_key:
        storage = getattr(request.app.state, "object_storage", None)
        delete_permanent_objects(session, storage, [storage_key], context="moderation_delete")
