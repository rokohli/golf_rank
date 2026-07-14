from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .models import (
    Comparison,
    Course,
    ActivityEvent,
    RankingConfidence,
    RankingSnapshot,
    TierAssignment,
    User,
)
from .schemas import ComparisonIn, RankingSnapshotOut, TierPlacementsIn


router = APIRouter(prefix="/api/v1/me/rankings", tags=["rankings"])

TIER_ORDER = ("green", "fairway", "rough", "bunker", "not_sure")
TIER_BANDS = {
    "green": (8.5, 10.0),
    "fairway": (7.0, 8.4),
    "rough": (5.0, 6.9),
    "bunker": (1.0, 4.9),
}
ALGORITHM_VERSION = "golf-tier-linear-v2"
LEGACY_TIERS = {
    "loved_it": "green",
    "liked_it": "fairway",
    "fine": "rough",
    "no": "bunker",
}


def _adapt_snapshot_entries(entries: list[dict]) -> list[dict]:
    return [
        {**entry, "tier": LEGACY_TIERS.get(entry["tier"], entry["tier"])}
        for entry in entries
    ]


def _stored_user(session: Session, user: CurrentUser, *, create: bool) -> User | None:
    stored = session.scalar(select(User).where(User.provider_subject == user.provider_subject))
    if stored is None and create:
        stored = User(provider_subject=user.provider_subject)
        session.add(stored)
        session.flush()
    return stored


def _normalize_positions(session: Session, user_id: int) -> list[TierAssignment]:
    assignments = list(
        session.scalars(
            select(TierAssignment)
            .where(TierAssignment.user_id == user_id)
            .order_by(TierAssignment.ordinal_position, TierAssignment.id)
        ).all()
    )
    grouped: dict[str, list[TierAssignment]] = defaultdict(list)
    for assignment in assignments:
        grouped[assignment.tier].append(assignment)
    ordered: list[TierAssignment] = []
    for tier in TIER_ORDER:
        for position, assignment in enumerate(grouped[tier], start=1):
            assignment.ordinal_position = position
            ordered.append(assignment)
    return ordered


def _rating(tier: str, index: int, count: int) -> float:
    low, high = TIER_BANDS[tier]
    if count == 1:
        return round((low + high) / 2, 1)
    return round(high - ((high - low) * index / (count - 1)), 1)


def _confidence_label(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.5:
        return "medium"
    return "low"


def _comparison_counts(session: Session, user_id: int) -> dict[int, tuple[int, int]]:
    counts: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    comparisons = session.scalars(
        select(Comparison).where(Comparison.user_id == user_id)
    ).all()
    for comparison in comparisons:
        bucket = 0 if comparison.outcome in ("course_a", "course_b", "decisive") else 1
        counts[comparison.course_a_id][bucket] += 1
        counts[comparison.course_b_id][bucket] += 1
    return {course_id: (values[0], values[1]) for course_id, values in counts.items()}


def _confidence(decisive: int, uncertain: int) -> float:
    # Tier placement is useful evidence. Decisive comparisons raise confidence;
    # skips and ties preserve the list while making uncertainty visible.
    return round(max(0.15, min(0.95, 0.35 + decisive * 0.15 - uncertain * 0.1)), 2)


def _stage_snapshot(session: Session, user_id: int) -> RankingSnapshotOut:
    # Serialize snapshot versions per user so concurrent mobile writes cannot
    # produce the same (user_id, version) pair.
    session.execute(select(User.id).where(User.id == user_id).with_for_update())
    assignments = _normalize_positions(session, user_id)
    course_ids = [assignment.course_id for assignment in assignments]
    courses = {
        course.id: course
        for course in session.scalars(select(Course).where(Course.id.in_(course_ids))).all()
    } if course_ids else {}
    counts = _comparison_counts(session, user_id)
    tier_counts = defaultdict(int)
    for assignment in assignments:
        if assignment.tier == "not_sure":
            continue
        tier_counts[assignment.tier] += 1

    entries: list[dict] = []
    confidence_scores: list[float] = []
    tier_indexes = defaultdict(int)
    ranked_assignments = [item for item in assignments if item.tier != "not_sure"]
    unranked_assignments = [item for item in assignments if item.tier == "not_sure"]
    for rank, assignment in enumerate(ranked_assignments, start=1):
        decisive, uncertain = counts.get(assignment.course_id, (0, 0))
        confidence = _confidence(decisive, uncertain)
        confidence_scores.append(confidence)
        existing = session.scalar(
            select(RankingConfidence).where(
                RankingConfidence.user_id == user_id,
                RankingConfidence.course_id == assignment.course_id,
            )
        )
        if existing is None:
            existing = RankingConfidence(user_id=user_id, course_id=assignment.course_id)
        existing.score = confidence
        existing.decisive_comparisons = decisive
        existing.uncertain_comparisons = uncertain
        session.add(existing)

        course = courses[assignment.course_id]
        tier_index = tier_indexes[assignment.tier]
        tier_indexes[assignment.tier] += 1
        entries.append(
            {
                "rank": rank,
                "course": {
                    "id": course.id,
                    "name": course.name,
                    "region": course.region,
                    "green_fee": course.green_fee,
                    "difficulty": course.difficulty,
                    "is_public": course.is_public,
                },
                "tier": assignment.tier,
                "tier_position": assignment.ordinal_position,
                "personal_rating": _rating(
                    assignment.tier, tier_index, tier_counts[assignment.tier]
                ),
                "confidence": confidence,
                "confidence_label": _confidence_label(confidence),
            }
        )

    overall_confidence = round(
        sum(confidence_scores) / len(confidence_scores), 2
    ) if confidence_scores else 0.0
    version = (session.scalar(
        select(func.max(RankingSnapshot.version)).where(RankingSnapshot.user_id == user_id)
    ) or 0) + 1
    created_at = datetime.now(UTC)
    unranked_courses = [
        {
            "id": courses[assignment.course_id].id,
            "name": courses[assignment.course_id].name,
            "region": courses[assignment.course_id].region,
            "green_fee": courses[assignment.course_id].green_fee,
            "difficulty": courses[assignment.course_id].difficulty,
            "is_public": courses[assignment.course_id].is_public,
        }
        for assignment in unranked_assignments
    ]
    snapshot = RankingSnapshot(
        user_id=user_id,
        version=version,
        algorithm_version=ALGORITHM_VERSION,
        overall_confidence=overall_confidence,
        ranking_data={"entries": entries, "unranked_courses": unranked_courses},
        created_at=created_at,
    )
    session.add(snapshot)
    session.add(
        ActivityEvent(
            actor_user_id=user_id,
            event_type="ranking_updated",
            subject_type="ranking_snapshot",
            subject_id=version,
            visibility="friends",
            event_data={"version": version, "course_count": len(entries)},
        )
    )
    session.flush()
    return RankingSnapshotOut(
        version=version,
        algorithm_version=ALGORITHM_VERSION,
        overall_confidence=overall_confidence,
        entries=entries,
        unranked_courses=unranked_courses,
        created_at=created_at,
    )


@router.get("", response_model=RankingSnapshotOut)
def get_ranking(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RankingSnapshotOut:
    stored = _stored_user(session, user, create=False)
    if stored is None:
        return RankingSnapshotOut(
            version=0,
            algorithm_version=ALGORITHM_VERSION,
            overall_confidence=0,
            entries=[],
            unranked_courses=[],
        )
    latest = session.scalar(
        select(RankingSnapshot)
        .where(RankingSnapshot.user_id == stored.id)
        .order_by(RankingSnapshot.version.desc())
        .limit(1)
    )
    if latest is None:
        return RankingSnapshotOut(
            version=0,
            algorithm_version=ALGORITHM_VERSION,
            overall_confidence=0,
            entries=[],
            unranked_courses=[],
        )
    entries = _adapt_snapshot_entries(latest.ranking_data["entries"])
    return RankingSnapshotOut(
        version=latest.version,
        algorithm_version=latest.algorithm_version,
        overall_confidence=latest.overall_confidence,
        entries=entries,
        unranked_courses=latest.ranking_data.get("unranked_courses", []),
        created_at=latest.created_at,
    )


@router.put("/tiers", response_model=RankingSnapshotOut)
def place_in_tiers(
    payload: TierPlacementsIn,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RankingSnapshotOut:
    course_ids = [assignment.course_id for assignment in payload.assignments]
    if len(course_ids) != len(set(course_ids)):
        raise HTTPException(422, "Each course can appear only once per request")
    existing_ids = set(session.scalars(select(Course.id).where(Course.id.in_(course_ids))).all())
    missing_ids = sorted(set(course_ids) - existing_ids)
    if missing_ids:
        raise HTTPException(404, f"Courses not found: {missing_ids}")

    stored = _stored_user(session, user, create=True)
    assert stored is not None
    for placement in payload.assignments:
        assignment = session.scalar(
            select(TierAssignment).where(
                TierAssignment.user_id == stored.id,
                TierAssignment.course_id == placement.course_id,
            )
        )
        if assignment is None:
            assignment = TierAssignment(user_id=stored.id, course_id=placement.course_id)
        assignment.tier = placement.tier
        # Put the course at the requested slot and shift its neighbors. This
        # supports one-course moves as well as the initial batch tier drop.
        peers = list(
            session.scalars(
                select(TierAssignment)
                .where(
                    TierAssignment.user_id == stored.id,
                    TierAssignment.tier == placement.tier,
                    TierAssignment.course_id != placement.course_id,
                )
                .order_by(TierAssignment.ordinal_position, TierAssignment.id)
            ).all()
        )
        target_index = min((placement.position or len(peers) + 1) - 1, len(peers))
        peers.insert(target_index, assignment)
        for position, peer in enumerate(peers, start=1):
            peer.ordinal_position = position
            session.add(peer)
        session.add(assignment)
    session.flush()
    snapshot = _stage_snapshot(session, stored.id)
    session.commit()
    return snapshot


@router.post("/comparisons", response_model=RankingSnapshotOut)
def compare_courses(
    payload: ComparisonIn,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> RankingSnapshotOut:
    if payload.course_a_id == payload.course_b_id:
        raise HTTPException(422, "A course cannot be compared with itself")
    stored = _stored_user(session, user, create=False)
    if stored is None:
        raise HTTPException(409, "Place both courses into tiers before comparing them")
    assignments = list(
        session.scalars(
            select(TierAssignment).where(
                TierAssignment.user_id == stored.id,
                TierAssignment.course_id.in_([payload.course_a_id, payload.course_b_id]),
            )
        ).all()
    )
    if len(assignments) != 2:
        raise HTTPException(409, "Place both courses into tiers before comparing them")
    if assignments[0].tier != assignments[1].tier:
        raise HTTPException(409, "Pairwise refinement only compares courses in the same tier")
    if assignments[0].tier == "not_sure":
        raise HTTPException(409, "Place both courses into ranking tiers before comparing them")

    preferred_id: int | None = None
    if payload.result in ("course_a", "course_b"):
        preferred_id = (
            payload.course_a_id if payload.result == "course_a" else payload.course_b_id
        )
        assignment_by_course = {item.course_id: item for item in assignments}
        winner = assignment_by_course[preferred_id]
        loser_id = payload.course_b_id if preferred_id == payload.course_a_id else payload.course_a_id
        loser = assignment_by_course[loser_id]
        if winner.ordinal_position > loser.ordinal_position:
            tier_order = list(
                session.scalars(
                    select(TierAssignment)
                    .where(
                        TierAssignment.user_id == stored.id,
                        TierAssignment.tier == winner.tier,
                    )
                    .order_by(TierAssignment.ordinal_position, TierAssignment.id)
                ).all()
            )
            tier_order.remove(winner)
            tier_order.insert(tier_order.index(loser), winner)
            for position, assignment in enumerate(tier_order, start=1):
                assignment.ordinal_position = position

    session.add(
        Comparison(
            user_id=stored.id,
            course_a_id=payload.course_a_id,
            course_b_id=payload.course_b_id,
            preferred_course_id=preferred_id,
            outcome=payload.result,
        )
    )
    session.flush()
    snapshot = _stage_snapshot(session, stored.id)
    session.commit()
    return snapshot
