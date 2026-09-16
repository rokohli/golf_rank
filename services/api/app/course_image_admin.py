"""Admin-triggered manual Openverse refresh for one course.

Separate from course_photo_moderation.py's router (prefixed
/api/v1/admin/course-photos, USER/OPENVERSE moderation actions on existing
rows) because this endpoint triggers a fresh Openverse search rather than
moderating an already-stored candidate.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .core.admin import require_admin
from .core.auth import CurrentUser
from .course_images.openverse_enrichment import enrich_course
from .course_images.repository import CourseImageRepository
from .db import get_session
from .domain import require_course

router = APIRouter(prefix="/api/v1/admin/courses", tags=["course-image-admin"])
_repository = CourseImageRepository()


@router.post("/{course_id}/images/search")
def search_course_images(
    course_id: int,
    request: Request,
    _admin: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict:
    """Runs a fresh Openverse search for one course and persists the outcome,
    synchronously (single course, admin-only, bounded by
    openverse_lookup_timeout_seconds -- the admin sees the result immediately
    rather than having to reload the moderation queue)."""
    settings = request.app.state.settings
    if not settings.openverse_enabled:
        raise HTTPException(400, "Openverse is not enabled")

    course = require_course(session, course_id)
    provider = request.app.state.course_image_service.openverse_provider
    if provider is None:
        raise HTTPException(400, "Openverse is not configured")

    outcome = enrich_course(session, _repository, provider, course, settings)
    return {
        "status": outcome.status,
        "course_id": course.id,
    }
