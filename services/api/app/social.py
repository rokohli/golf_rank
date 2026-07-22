import base64
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_course, require_user, stored_user
from .models import (
    ActivityEvent,
    ActivityReaction,
    Course,
    Follow,
    OnboardingPreference,
    Profile,
    User,
    UserBlock,
    UserMute,
)
from .schemas import CourseOut


router = APIRouter(tags=["social"])


class UserSummaryOut(BaseModel):
    id: int
    username: str | None
    display_name: str
    home_region: str | None
    follower_count: int
    following_count: int


class FollowOut(BaseModel):
    user: UserSummaryOut
    is_mutual: bool
    followed_at: datetime


class ActivityOut(BaseModel):
    id: int
    event_type: str
    subject_type: str
    subject_id: int
    actor: UserSummaryOut
    course: CourseOut | None
    data: dict
    reaction_count: int = 0
    viewer_reacted: bool = False
    is_own_activity: bool = False
    created_at: datetime


class FeedPageOut(BaseModel):
    items: list[ActivityOut]
    next_cursor: str | None


class ReactionOut(BaseModel):
    event_id: int
    reaction: str
    reaction_count: int
    viewer_reacted: bool


def _summary(session: Session, user: User) -> UserSummaryOut:
    preferences = session.get(OnboardingPreference, user.id)
    profile = session.get(Profile, user.id)
    onboarding = preferences.onboarding_data if preferences and preferences.onboarding_data else {}
    first_name = onboarding.get("first_name")
    last_name = onboarding.get("last_name")
    display_name = " ".join(item for item in (first_name, last_name) if item).strip()
    return UserSummaryOut(
        id=user.id,
        username=onboarding.get("username"),
        display_name=display_name or f"Golfer {user.id}",
        home_region=profile.home_region if profile else None,
        follower_count=session.scalar(select(func.count(Follow.id)).where(Follow.followed_id == user.id)) or 0,
        following_count=session.scalar(select(func.count(Follow.id)).where(Follow.follower_id == user.id)) or 0,
    )


def _blocked_ids(session: Session, user_id: int) -> set[int]:
    outgoing = session.scalars(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user_id)).all()
    incoming = session.scalars(select(UserBlock.blocker_id).where(UserBlock.blocked_id == user_id)).all()
    return set(outgoing) | set(incoming)


def _relationship_sets(session: Session, user_id: int) -> tuple[set[int], set[int]]:
    followed_ids = set(session.scalars(select(Follow.followed_id).where(Follow.follower_id == user_id)).all())
    reverse_ids = set(session.scalars(select(Follow.follower_id).where(Follow.followed_id == user_id)).all())
    return followed_ids, followed_ids & reverse_ids


def _profile_visibility(session: Session, user_id: int) -> str:
    preferences = session.get(OnboardingPreference, user_id)
    onboarding = preferences.onboarding_data if preferences and preferences.onboarding_data else {}
    return onboarding.get("profile_visibility", "public")


def _event_visible(event: ActivityEvent, viewer_id: int, followed_ids: set[int], mutual_ids: set[int]) -> bool:
    return (
        event.actor_user_id == viewer_id
        or (event.actor_user_id in followed_ids and event.visibility == "public")
        or (event.actor_user_id in mutual_ids and event.visibility == "friends")
    )


def _cursor(event: ActivityEvent) -> str:
    raw = f"{event.created_at.isoformat()}|{event.id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        decoded = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        created_at, event_id = decoded.rsplit("|", 1)
        return datetime.fromisoformat(created_at), int(event_id)
    except (ValueError, UnicodeDecodeError) as error:
        raise HTTPException(422, "Invalid feed cursor") from error


def _reaction_state(session: Session, event_id: int, user_id: int) -> tuple[int, bool]:
    count = session.scalar(select(func.count(ActivityReaction.id)).where(ActivityReaction.event_id == event_id)) or 0
    reacted = session.scalar(
        select(ActivityReaction.id).where(
            ActivityReaction.event_id == event_id,
            ActivityReaction.user_id == user_id,
            ActivityReaction.reaction == "like",
        )
    ) is not None
    return count, reacted


@router.get("/api/v1/users", response_model=list[UserSummaryOut])
def search_users(
    q: str = Query(min_length=1, max_length=80),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[UserSummaryOut]:
    current_record = require_user(session, current)
    excluded = _blocked_ids(session, current_record.id) | {current_record.id}
    _, mutual_ids = _relationship_sets(session, current_record.id)
    needle = q.casefold()
    users = session.scalars(select(User).where(User.id.not_in(excluded)).limit(200)).all()
    results: list[UserSummaryOut] = []
    for user in users:
        visibility = _profile_visibility(session, user.id)
        if visibility == "private" or (visibility == "friends" and user.id not in mutual_ids):
            continue
        summary = _summary(session, user)
        haystack = f"{summary.username or ''} {summary.display_name} {summary.home_region or ''}".casefold()
        if needle in haystack:
            results.append(summary)
        if len(results) == 25:
            break
    return results


@router.put("/api/v1/me/follows/{target_user_id}", response_model=FollowOut)
def follow_user(
    target_user_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> FollowOut:
    user = require_user(session, current, create=True)
    if target_user_id == user.id:
        raise HTTPException(422, "You cannot follow yourself")
    target = session.get(User, target_user_id)
    if target is None:
        raise HTTPException(404, "User not found")
    if target_user_id in _blocked_ids(session, user.id):
        raise HTTPException(404, "User not found")
    follow = session.scalar(select(Follow).where(Follow.follower_id == user.id, Follow.followed_id == target_user_id))
    if follow is None:
        follow = Follow(follower_id=user.id, followed_id=target_user_id)
        session.add(follow)
        session.commit()
    mutual = session.scalar(select(Follow.id).where(Follow.follower_id == target_user_id, Follow.followed_id == user.id)) is not None
    return FollowOut(user=_summary(session, target), is_mutual=mutual, followed_at=follow.created_at)


@router.delete("/api/v1/me/follows/{target_user_id}", status_code=204)
def unfollow_user(
    target_user_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    session.execute(delete(Follow).where(Follow.follower_id == user.id, Follow.followed_id == target_user_id))
    session.commit()
    return Response(status_code=204)


@router.get("/api/v1/me/follows", response_model=list[FollowOut])
def list_follows(
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[FollowOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    blocked = _blocked_ids(session, user.id)
    follows = session.scalars(
        select(Follow).where(Follow.follower_id == user.id, Follow.followed_id.not_in(blocked)).order_by(Follow.created_at.desc())
    ).all()
    reverse_ids = set(session.scalars(select(Follow.follower_id).where(Follow.followed_id == user.id)).all())
    return [FollowOut(user=_summary(session, session.get(User, follow.followed_id)), is_mutual=follow.followed_id in reverse_ids, followed_at=follow.created_at) for follow in follows]


@router.get("/api/v1/feed", response_model=FeedPageOut)
def activity_feed(
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = None,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> FeedPageOut:
    user = stored_user(session, current)
    if user is None:
        return FeedPageOut(items=[], next_cursor=None)
    followed_ids, mutual_ids = _relationship_sets(session, user.id)
    excluded = _blocked_ids(session, user.id) | set(
        session.scalars(select(UserMute.muted_id).where(UserMute.muter_id == user.id)).all()
    )
    visible_public_ids = followed_ids - excluded
    visible_friend_ids = mutual_ids - excluded
    statement = select(ActivityEvent).where(
        or_(
            ActivityEvent.actor_user_id == user.id,
            and_(
                ActivityEvent.actor_user_id.in_(visible_public_ids),
                ActivityEvent.visibility == "public",
            ),
            and_(
                ActivityEvent.actor_user_id.in_(visible_friend_ids),
                ActivityEvent.visibility == "friends",
            ),
        )
    )
    cursor_boundary: tuple[datetime, int] | None = None
    if cursor:
        created_at, event_id = _decode_cursor(cursor)
        cursor_boundary = (created_at, event_id)
        # Fetch the boundary timestamp and perform the ID tiebreak in Python.
        # SQLite serializes zero microseconds differently from PostgreSQL,
        # which makes direct timestamp equality unreliable in cross-DB tests.
        statement = statement.where(ActivityEvent.created_at <= created_at)
    output: list[ActivityOut] = []
    last_event: ActivityEvent | None = None
    batch_size = max(100, limit * 2)
    offset = 0
    while len(output) <= limit:
        events = session.scalars(
            statement.order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
            .offset(offset)
            .limit(batch_size)
        ).all()
        if not events:
            break
        offset += len(events)
        for event in events:
            if cursor_boundary and (
                event.created_at > cursor_boundary[0]
                or (event.created_at == cursor_boundary[0] and event.id >= cursor_boundary[1])
            ):
                continue
            if not _event_visible(event, user.id, followed_ids, mutual_ids):
                continue
            actor = session.get(User, event.actor_user_id)
            if actor is None:
                continue
            course = None
            course_id = event.event_data.get("course_id")
            if isinstance(course_id, int):
                try:
                    stored_course = require_course(session, course_id)
                except HTTPException:
                    stored_course = None
                if stored_course is not None:
                    course = course_data(stored_course)
            reaction_count, viewer_reacted = _reaction_state(session, event.id, user.id)
            output.append(ActivityOut(
                id=event.id, event_type=event.event_type, subject_type=event.subject_type,
                subject_id=event.subject_id, actor=_summary(session, actor), course=course,
                data=event.event_data, reaction_count=reaction_count, viewer_reacted=viewer_reacted,
                is_own_activity=event.actor_user_id == user.id,
                created_at=event.created_at,
            ))
            last_event = event
            if len(output) > limit:
                break
        if len(output) > limit or len(events) < batch_size:
            break
    has_more = len(output) > limit
    if has_more:
        output = output[:limit]
        last_event = session.get(ActivityEvent, output[-1].id)
    return FeedPageOut(items=output, next_cursor=_cursor(last_event) if has_more and last_event else None)


def _require_visible_event(session: Session, user_id: int, event_id: int) -> ActivityEvent:
    event = session.get(ActivityEvent, event_id)
    if event is None or event.actor_user_id in _blocked_ids(session, user_id):
        raise HTTPException(404, "Activity not found")
    followed_ids, mutual_ids = _relationship_sets(session, user_id)
    if not _event_visible(event, user_id, followed_ids, mutual_ids):
        raise HTTPException(404, "Activity not found")
    return event


@router.put("/api/v1/feed/{event_id}/reactions/{reaction}", response_model=ReactionOut)
def add_reaction(
    event_id: int,
    reaction: str,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> ReactionOut:
    if reaction != "like":
        raise HTTPException(422, "Unsupported reaction")
    user = require_user(session, current)
    _require_visible_event(session, user.id, event_id)
    existing = session.scalar(select(ActivityReaction).where(ActivityReaction.event_id == event_id, ActivityReaction.user_id == user.id, ActivityReaction.reaction == reaction))
    if existing is None:
        session.add(ActivityReaction(event_id=event_id, user_id=user.id, reaction=reaction))
        session.commit()
    count, reacted = _reaction_state(session, event_id, user.id)
    return ReactionOut(event_id=event_id, reaction=reaction, reaction_count=count, viewer_reacted=reacted)


@router.delete("/api/v1/feed/{event_id}/reactions/{reaction}", response_model=ReactionOut)
def remove_reaction(
    event_id: int,
    reaction: str,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> ReactionOut:
    user = require_user(session, current)
    _require_visible_event(session, user.id, event_id)
    session.execute(delete(ActivityReaction).where(ActivityReaction.event_id == event_id, ActivityReaction.user_id == user.id, ActivityReaction.reaction == reaction))
    session.commit()
    count, reacted = _reaction_state(session, event_id, user.id)
    return ReactionOut(event_id=event_id, reaction=reaction, reaction_count=count, viewer_reacted=reacted)


def _relationship_target(session: Session, user_id: int, target_user_id: int) -> User:
    if target_user_id == user_id:
        raise HTTPException(422, "You cannot select yourself")
    target = session.get(User, target_user_id)
    if target is None:
        raise HTTPException(404, "User not found")
    return target


@router.put("/api/v1/me/blocks/{target_user_id}", status_code=204)
def block_user(target_user_id: int, current: CurrentUser = Depends(current_user), session: Session = Depends(get_session)) -> Response:
    user = require_user(session, current)
    _relationship_target(session, user.id, target_user_id)
    if session.scalar(select(UserBlock.id).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == target_user_id)) is None:
        session.add(UserBlock(blocker_id=user.id, blocked_id=target_user_id))
    session.execute(delete(Follow).where(or_(and_(Follow.follower_id == user.id, Follow.followed_id == target_user_id), and_(Follow.follower_id == target_user_id, Follow.followed_id == user.id))))
    session.commit()
    return Response(status_code=204)


@router.delete("/api/v1/me/blocks/{target_user_id}", status_code=204)
def unblock_user(target_user_id: int, current: CurrentUser = Depends(current_user), session: Session = Depends(get_session)) -> Response:
    user = require_user(session, current)
    session.execute(delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == target_user_id))
    session.commit()
    return Response(status_code=204)


@router.put("/api/v1/me/mutes/{target_user_id}", status_code=204)
def mute_user(target_user_id: int, current: CurrentUser = Depends(current_user), session: Session = Depends(get_session)) -> Response:
    user = require_user(session, current)
    _relationship_target(session, user.id, target_user_id)
    if session.scalar(select(UserMute.id).where(UserMute.muter_id == user.id, UserMute.muted_id == target_user_id)) is None:
        session.add(UserMute(muter_id=user.id, muted_id=target_user_id))
        session.commit()
    return Response(status_code=204)


@router.delete("/api/v1/me/mutes/{target_user_id}", status_code=204)
def unmute_user(target_user_id: int, current: CurrentUser = Depends(current_user), session: Session = Depends(get_session)) -> Response:
    user = require_user(session, current)
    session.execute(delete(UserMute).where(UserMute.muter_id == user.id, UserMute.muted_id == target_user_id))
    session.commit()
    return Response(status_code=204)
