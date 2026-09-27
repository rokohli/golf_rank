from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from .domain import course_identity_ids
from .models import Course, Round
from .schemas import (
    ALLOWED_ROUND_TAGS,
    LOCOMOTION_TAGS,
    CourseGolferReportsOut,
    HighlightReportOut,
    LocomotionReportOut,
)


TAG_DISPLAY_LABELS: dict[str, str] = {
    # Locomotion
    "walked": "Walked",
    "cart": "Riding Cart",
    # Bag & Assistance
    "push_cart": "Push Cart",
    "caddie": "Caddie",
    # Scenery & Setting
    "ocean_views": "Ocean Views",
    "mountain_views": "Mountain Views",
    "scenic_views": "Scenic Views",
    "links_style": "Links Style",
    "tree_lined": "Tree-Lined",
    # Greens & Challenge
    "fast_greens": "Fast Greens",
    "challenging_greens": "Tricky Greens",
    "pristine_fairways": "Great Fairways",
    "punishing_rough": "Punishing Rough",
    # Atmosphere & Amenities
    "great_practice_facility": "Great Practice Range",
    "welcoming_staff": "Welcoming Vibe",
    "great_food_drink": "Great Food & Drink",
    "beginner_friendly": "Beginner Friendly",
}

DEFAULT_RECENCY_DAYS = 730  # Rolling 24-month window
MIN_GOLFER_THRESHOLD = 3


def get_course_golfer_reports(
    session: Session,
    course: Course,
    *,
    as_of: date | None = None,
    recency_days: int = DEFAULT_RECENCY_DAYS,
    min_threshold: int = MIN_GOLFER_THRESHOLD,
) -> CourseGolferReportsOut | None:
    """Aggregate community observations from golfer round tags for a course.

    Invariants:
    1. Reconciles canonical and alias course IDs.
    2. Selects each distinct golfer's single latest round across the reconciled course
       (ORDER BY played_on DESC, id DESC) BEFORE checking eligibility.
    3. Eligible rounds must have visibility == 'public', played_on >= cutoff (rolling 24 mos),
       and non-empty tags. Ineligible latest rounds contribute 0 reports (never falls back
       to older rounds).
    4. Requires >= min_threshold distinct reporting golfers for locomotion and highlights.
    5. Returns None if no consensus observation meets the threshold.
    """
    reference_date = as_of or date.today()
    cutoff_date = reference_date - timedelta(days=recency_days)
    identity_ids = course_identity_ids(session, course)

    # Window function to pick each golfer's single most authoritative latest round
    subq = (
        select(
            Round.id,
            Round.user_id,
            Round.course_id,
            Round.played_on,
            Round.visibility,
            Round.tags,
            func.row_number().over(
                partition_by=Round.user_id,
                order_by=(Round.played_on.desc(), Round.id.desc()),
            ).label("rn"),
        )
        .where(
            Round.course_id.in_(identity_ids),
            Round.played_on >= cutoff_date,
        )
        .subquery()
    )

    aliased_round = aliased(Round, subq)
    latest_rounds = session.scalars(select(aliased_round).where(subq.c.rn == 1)).all()

    eligible_golfer_tags: list[list[str]] = []
    for round_ in latest_rounds:
        # Eligibility criteria evaluated strictly on the latest round
        if round_.visibility != "public":
            continue
        if round_.played_on < cutoff_date:
            continue
        if not round_.tags:
            continue
        eligible_golfer_tags.append(round_.tags)

    if len(eligible_golfer_tags) < min_threshold:
        return None

    # Locomotion calculation (walked vs cart)
    walk_count = sum(1 for tags in eligible_golfer_tags if "walked" in tags)
    cart_count = sum(1 for tags in eligible_golfer_tags if "cart" in tags)
    locomotion_total = walk_count + cart_count

    locomotion: LocomotionReportOut | None = None
    if locomotion_total >= min_threshold:
        walk_percentage = round((walk_count / locomotion_total) * 100)
        locomotion = LocomotionReportOut(
            walk_count=walk_count,
            cart_count=cart_count,
            total_reporters=locomotion_total,
            walk_percentage=walk_percentage,
            label=f"{walk_count} of {locomotion_total} reporting golfers walked",
        )

    # Highlights calculation (all non-locomotion tags)
    tag_counts: dict[str, int] = {}
    for tags in eligible_golfer_tags:
        for tag in set(tags):
            if tag not in LOCOMOTION_TAGS and tag in ALLOWED_ROUND_TAGS:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

    highlights: list[HighlightReportOut] = []
    for tag, count in tag_counts.items():
        if count >= min_threshold:
            highlights.append(
                HighlightReportOut(
                    tag=tag,
                    label=TAG_DISPLAY_LABELS.get(tag, tag.replace("_", " ").title()),
                    count=count,
                )
            )
    highlights.sort(key=lambda item: (-item.count, item.label))

    # Suppress output if neither locomotion nor any highlight met consensus threshold
    if locomotion is None and not highlights:
        return None

    return CourseGolferReportsOut(
        total_reporting_golfers=len(eligible_golfer_tags),
        locomotion=locomotion,
        highlights=highlights,
    )
