from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_course, require_user, stored_user
from .models import (
    ActivityEvent,
    Comparison,
    Course,
    Follow,
    Round,
    RoundCompanion,
    RoundNote,
    TierAssignment,
    User,
    UserCourseRating,
)
from .ranking import _stage_snapshot
from .rounds import _event_data, _refresh_course_state
from .schemas import (
    CourseOut,
    CourseRatingIn,
    CourseRatingStateOut,
    RatingDetailsPatch,
    RankingSnapshotOut,
    RankingTier,
)


router = APIRouter(prefix="/api/v1/me/course-ratings", tags=["course-ratings"])


def _aggregate(session: Session, course_id: int) -> tuple[float | None, int]:
    average, count = session.execute(
        select(func.avg(UserCourseRating.rating), func.count(UserCourseRating.id)).where(
            UserCourseRating.course_id == course_id
        )
    ).one()
    return (round(float(average), 1) if average is not None else None, int(count))


def _course_with_aggregate(
    course: Course, average: float | None, count: int
) -> dict:
    return {**course_data(course), "community_rating": average, "rating_count": count}


def _state(
    session: Session, course: Course, user_id: int | None
) -> CourseRatingStateOut:
    average, count = _aggregate(session, course.id)
    rating = None
    round_ = None
    note = None
    companions = []
    if user_id is not None:
        rating = session.scalar(
            select(UserCourseRating).where(
                UserCourseRating.user_id == user_id,
                UserCourseRating.course_id == course.id,
            )
        )
        if rating is not None:
            round_ = session.scalar(
                select(Round).where(Round.id == rating.round_id, Round.user_id == user_id)
            )
            if round_ is not None:
                note = session.get(RoundNote, round_.id)
                companions = list(
                    session.scalars(
                        select(RoundCompanion)
                        .where(RoundCompanion.round_id == round_.id)
                        .order_by(RoundCompanion.id)
                    ).all()
                )
    return CourseRatingStateOut(
        course=_course_with_aggregate(course, average, count),
        personal_rating=rating.rating if rating else None,
        tier=rating.tier if rating else None,
        confidence=rating.confidence if rating else None,
        community_rating=average,
        rating_count=count,
        round=(
            {
                "id": round_.id,
                "played_on": round_.played_on,
                "score": round_.score,
                "note": note.body if note else None,
                "favorite_hole": round_.favorite_hole,
                "visibility": round_.visibility,
            }
            if round_ is not None
            else None
        ),
        companions=[
            {
                "friend_user_id": companion.friend_user_id,
                "guest_name": companion.guest_name,
            }
            for companion in companions
        ],
    )


def _place_assignment(
    session: Session, user_id: int, course_id: int, tier: str
) -> TierAssignment:
    assignment = session.scalar(
        select(TierAssignment).where(
            TierAssignment.user_id == user_id,
            TierAssignment.course_id == course_id,
        )
    )
    if assignment is not None and assignment.tier == tier:
        return assignment
    if assignment is None:
        assignment = TierAssignment(user_id=user_id, course_id=course_id)
    peers = list(
        session.scalars(
            select(TierAssignment)
            .where(
                TierAssignment.user_id == user_id,
                TierAssignment.tier == tier,
                TierAssignment.course_id != course_id,
            )
            .order_by(TierAssignment.ordinal_position, TierAssignment.id)
        ).all()
    )
    assignment.tier = tier
    assignment.ordinal_position = len(peers) + 1
    session.add(assignment)
    return assignment


def _stage_comparison(
    session: Session,
    user_id: int,
    course_id: int,
    tier: str,
    comparison_course_id: int,
    result: str,
) -> None:
    if comparison_course_id == course_id:
        raise HTTPException(422, "A course cannot be compared with itself")
    require_course(session, comparison_course_id)
    peer = session.scalar(
        select(TierAssignment).where(
            TierAssignment.user_id == user_id,
            TierAssignment.course_id == comparison_course_id,
        )
    )
    target = session.scalar(
        select(TierAssignment).where(
            TierAssignment.user_id == user_id,
            TierAssignment.course_id == course_id,
        )
    )
    if peer is None or target is None or peer.tier != tier:
        raise HTTPException(409, "Comparison course must be in the same tier")

    preferred_id = None
    if result in ("course_a", "course_b"):
        preferred_id = course_id if result == "course_a" else comparison_course_id
        winner = target if preferred_id == course_id else peer
        loser = peer if preferred_id == course_id else target
        if winner.ordinal_position > loser.ordinal_position:
            ordered = list(
                session.scalars(
                    select(TierAssignment)
                    .where(TierAssignment.user_id == user_id, TierAssignment.tier == tier)
                    .order_by(TierAssignment.ordinal_position, TierAssignment.id)
                ).all()
            )
            ordered.remove(winner)
            ordered.insert(ordered.index(loser), winner)
            for position, item in enumerate(ordered, start=1):
                item.ordinal_position = position
    session.add(
        Comparison(
            user_id=user_id,
            course_a_id=course_id,
            course_b_id=comparison_course_id,
            preferred_course_id=preferred_id,
            outcome=result,
        )
    )


def _ensure_target_rating_projection(
    session: Session,
    user_id: int,
    target_course_id: int,
    target_round_id: int,
    snapshot: RankingSnapshotOut,
) -> None:
    entry = next(
        (item for item in snapshot.entries if item.course.id == target_course_id),
        None,
    )
    if entry is None:
        raise RuntimeError("Rated course missing from staged ranking snapshot")
    projection = session.scalar(
        select(UserCourseRating).where(
            UserCourseRating.user_id == user_id,
            UserCourseRating.course_id == target_course_id,
        )
    )
    if projection is None:
        projection = UserCourseRating(
            user_id=user_id,
            course_id=target_course_id,
            round_id=target_round_id,
        )
    projection.tier = entry.tier
    projection.rating = entry.personal_rating
    projection.confidence = entry.confidence
    session.add(projection)


def _upsert_round_event(session: Session, user_id: int, round_: Round) -> None:
    event = session.scalar(
        select(ActivityEvent).where(
            ActivityEvent.actor_user_id == user_id,
            ActivityEvent.subject_type == "round",
            ActivityEvent.subject_id == round_.id,
        )
    )
    if event is None:
        event = ActivityEvent(
            actor_user_id=user_id,
            event_type="round_logged",
            subject_type="round",
            subject_id=round_.id,
        )
    event.visibility = round_.visibility
    event.event_data = _event_data(round_)
    session.add(event)


@router.get("/{course_id}", response_model=CourseRatingStateOut)
def get_course_rating(
    course_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> CourseRatingStateOut:
    course = require_course(session, course_id)
    user = stored_user(session, current)
    return _state(session, course, user.id if user else None)


@router.get("/{course_id}/comparison-candidate", response_model=CourseOut | None)
def comparison_candidate(
    course_id: int,
    tier: RankingTier = Query(),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> dict | None:
    require_course(session, course_id)
    user = stored_user(session, current)
    if user is None:
        return None
    candidates = list(
        session.execute(
            select(TierAssignment, Course)
            .join(Course, Course.id == TierAssignment.course_id)
            .where(
                TierAssignment.user_id == user.id,
                TierAssignment.tier == tier,
                TierAssignment.course_id != course_id,
            )
            .order_by(TierAssignment.ordinal_position, Course.id)
        ).all()
    )
    if not candidates:
        return None
    candidate_ids = [assignment.course_id for assignment, _ in candidates]
    counts = defaultdict(int)
    for left, right, count in session.execute(
        select(
            Comparison.course_a_id,
            Comparison.course_b_id,
            func.count(Comparison.id),
        )
        .where(
            Comparison.user_id == user.id,
            or_(
                (Comparison.course_a_id == course_id)
                & (Comparison.course_b_id.in_(candidate_ids)),
                (Comparison.course_b_id == course_id)
                & (Comparison.course_a_id.in_(candidate_ids)),
            ),
        )
        .group_by(Comparison.course_a_id, Comparison.course_b_id)
    ).all():
        peer_id = right if left == course_id else left
        counts[peer_id] += count
    _, course = min(
        candidates,
        key=lambda row: (counts[row[0].course_id], row[0].ordinal_position, row[1].id),
    )
    average, count = _aggregate(session, course.id)
    return _course_with_aggregate(course, average, count)


@router.put("/{course_id}", response_model=CourseRatingStateOut)
def put_course_rating(
    course_id: int,
    payload: CourseRatingIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> CourseRatingStateOut:
    course = require_course(session, course_id)
    try:
        user = require_user(session, current, create=True)
        _place_assignment(session, user.id, course_id, payload.tier)
        session.flush()
        if payload.comparison_course_id is not None and payload.comparison_result is not None:
            _stage_comparison(
                session,
                user.id,
                course_id,
                payload.tier,
                payload.comparison_course_id,
                payload.comparison_result,
            )

        existing_rating = session.scalar(
            select(UserCourseRating).where(
                UserCourseRating.user_id == user.id,
                UserCourseRating.course_id == course_id,
            )
        )
        round_ = session.get(Round, existing_rating.round_id) if existing_rating else None
        if round_ is None:
            round_ = Round(
                user_id=user.id,
                course_id=course_id,
                visibility="private",
            )
        round_.played_on = payload.played_on
        round_.score = payload.score
        round_.is_rating_round = True
        session.add(round_)
        session.flush()

        snapshot = _stage_snapshot(session, user.id)
        _ensure_target_rating_projection(session, user.id, course_id, round_.id, snapshot)
        _refresh_course_state(session, user.id, course_id)
        _upsert_round_event(session, user.id, round_)
        session.flush()
        result = _state(session, course, user.id)
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


@router.patch("/{course_id}/details", response_model=CourseRatingStateOut)
def patch_rating_details(
    course_id: int,
    payload: RatingDetailsPatch,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> CourseRatingStateOut:
    course = require_course(session, course_id)
    user = require_user(session, current)
    rating = session.scalar(
        select(UserCourseRating).where(
            UserCourseRating.user_id == user.id,
            UserCourseRating.course_id == course_id,
        )
    )
    if rating is None:
        raise HTTPException(404, "Course rating not found")
    round_ = session.scalar(
        select(Round).where(Round.id == rating.round_id, Round.user_id == user.id)
    )
    if round_ is None:
        raise HTTPException(404, "Rating round not found")

    friend_ids = list(dict.fromkeys(payload.friend_user_ids))
    if friend_ids:
        user_ids = set(session.scalars(select(User.id).where(User.id.in_(friend_ids))).all())
        followed_ids = set(
            session.scalars(
                select(Follow.followed_id).where(
                    Follow.follower_id == user.id, Follow.followed_id.in_(friend_ids)
                )
            ).all()
        )
        if user_ids != set(friend_ids) or followed_ids != set(friend_ids):
            raise HTTPException(422, "All friend_user_ids must be followed users")

    guest_names = list(dict.fromkeys(name.strip() for name in payload.guest_names))
    round_.favorite_hole = payload.favorite_hole
    round_.visibility = payload.visibility
    note = session.get(RoundNote, round_.id)
    if payload.note is None:
        if note is not None:
            session.delete(note)
    elif note is None:
        session.add(RoundNote(round_id=round_.id, body=payload.note))
    else:
        note.body = payload.note
    session.execute(delete(RoundCompanion).where(RoundCompanion.round_id == round_.id))
    session.flush()
    session.add_all(
        [RoundCompanion(round_id=round_.id, friend_user_id=friend_id) for friend_id in friend_ids]
        + [RoundCompanion(round_id=round_.id, guest_name=name) for name in guest_names]
    )
    _upsert_round_event(session, user.id, round_)
    session.flush()
    result = _state(session, course, user.id)
    session.commit()
    return result
