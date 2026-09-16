"""Crowdsourced green-fee suggestions.

A suggestion only auto-applies to Course.green_fee when the canonical value
is still null -- this fills gaps in the catalog, it never lets a pair of
accounts silently override an already-verified import value. Two or more
suggestions landing within FEE_AGREEMENT_TOLERANCE of each other (by value,
not by submission order) form the agreeing cluster whose average gets
applied; a lone outlier or a single submission stays PENDING until it either
gets company within tolerance or the course's fee is otherwise resolved.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.rate_limit import green_fee_suggestion_rate_limit
from .db import get_session
from .domain import require_course, require_user
from .models import Course, CourseGreenFeeSuggestion, CourseGreenFeeSuggestionStatus
from .schemas import GreenFeeSuggestionOut, GreenFeeSuggestionRequest

router = APIRouter(tags=["green-fee-suggestions"])

# A suggestion "agrees" with another if the larger is within 25% of the
# smaller -- loose enough that e.g. $60 vs $70 still cluster, tight enough
# that $40 vs $150 (almost certainly two different fee tiers, or one bad
# submission) never gets averaged together.
FEE_AGREEMENT_TOLERANCE = 0.25


def _largest_agreeing_cluster(
    rows: list[CourseGreenFeeSuggestion],
) -> list[CourseGreenFeeSuggestion] | None:
    """The largest contiguous run, once sorted by fee, whose top value is
    within FEE_AGREEMENT_TOLERANCE of its bottom value. None if no run of
    2 or more rows qualifies."""

    ordered = sorted(rows, key=lambda row: row.suggested_fee)
    best: list[CourseGreenFeeSuggestion] | None = None
    start = 0
    for end in range(len(ordered)):
        while ordered[end].suggested_fee > ordered[start].suggested_fee * (1 + FEE_AGREEMENT_TOLERANCE):
            start += 1
        window = ordered[start : end + 1]
        if len(window) >= 2 and (best is None or len(window) > len(best)):
            best = window
    return best


@router.post(
    "/api/v1/courses/{course_id}/fee-suggestions",
    response_model=GreenFeeSuggestionOut,
    status_code=201,
    dependencies=[Depends(green_fee_suggestion_rate_limit)],
)
def submit_green_fee_suggestion(
    course_id: int,
    payload: GreenFeeSuggestionRequest,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> GreenFeeSuggestionOut:
    user = require_user(session, current, create=True)
    course = require_course(session, course_id)
    # Serializes concurrent submissions for the same course, and reads
    # green_fee fresh (not the possibly-stale value already loaded onto
    # `course`) under that lock. Without this, two different users
    # submitting agreeing fees at nearly the same moment can each read the
    # pending set under READ COMMITTED before the other's row commits --
    # both see only their own submission, and a qualifying pair never gets
    # applied until someone happens to submit a third time.
    locked_green_fee = session.execute(
        select(Course.green_fee).where(Course.id == course.id).with_for_update()
    ).scalar_one()
    if locked_green_fee is not None:
        raise HTTPException(409, "This course already has a known green fee.")

    existing = session.scalar(
        select(CourseGreenFeeSuggestion).where(
            CourseGreenFeeSuggestion.course_id == course.id,
            CourseGreenFeeSuggestion.submitted_by_user_id == user.id,
        )
    )
    if existing is not None:
        existing.suggested_fee = payload.suggested_fee
        existing.status = CourseGreenFeeSuggestionStatus.PENDING
        existing.updated_at = datetime.now(UTC)
    else:
        session.add(CourseGreenFeeSuggestion(
            course_id=course.id,
            submitted_by_user_id=user.id,
            suggested_fee=payload.suggested_fee,
        ))
    session.flush()

    applied = False
    pending = session.scalars(
        select(CourseGreenFeeSuggestion).where(
            CourseGreenFeeSuggestion.course_id == course.id,
            CourseGreenFeeSuggestion.status == CourseGreenFeeSuggestionStatus.PENDING,
        )
    ).all()
    cluster = _largest_agreeing_cluster(pending)
    if cluster is not None:
        course.green_fee = round(sum(row.suggested_fee for row in cluster) / len(cluster))
        for row in cluster:
            row.status = CourseGreenFeeSuggestionStatus.APPLIED
        applied = any(row.submitted_by_user_id == user.id for row in cluster)

    session.commit()
    return GreenFeeSuggestionOut(
        course_id=course.id,
        suggested_fee=payload.suggested_fee,
        applied=applied,
        course_green_fee=course.green_fee,
    )
