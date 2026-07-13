from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .db import get_session
from .domain import course_data, require_user, stored_user
from .models import ActivityEvent, Course, Follow, OnboardingPreference, Profile, User
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
    actor: UserSummaryOut
    course: CourseOut | None
    data: dict
    created_at: datetime


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
        follower_count=session.scalar(
            select(func.count(Follow.id)).where(Follow.followed_id == user.id)
        ) or 0,
        following_count=session.scalar(
            select(func.count(Follow.id)).where(Follow.follower_id == user.id)
        ) or 0,
    )


@router.get("/api/v1/users", response_model=list[UserSummaryOut])
def search_users(
    q: str = Query(min_length=1, max_length=80),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[UserSummaryOut]:
    current_user_record = require_user(session, current)
    needle = q.casefold()
    users = session.scalars(select(User).where(User.id != current_user_record.id).limit(200)).all()
    results: list[UserSummaryOut] = []
    for user in users:
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
    follow = session.scalar(
        select(Follow).where(
            Follow.follower_id == user.id, Follow.followed_id == target_user_id
        )
    )
    if follow is None:
        follow = Follow(follower_id=user.id, followed_id=target_user_id)
        session.add(follow)
        session.commit()
    mutual = session.scalar(
        select(Follow.id).where(
            Follow.follower_id == target_user_id, Follow.followed_id == user.id
        )
    ) is not None
    return FollowOut(user=_summary(session, target), is_mutual=mutual, followed_at=follow.created_at)


@router.delete("/api/v1/me/follows/{target_user_id}", status_code=204)
def unfollow_user(
    target_user_id: int,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    session.execute(
        delete(Follow).where(
            Follow.follower_id == user.id, Follow.followed_id == target_user_id
        )
    )
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
    follows = session.scalars(
        select(Follow)
        .where(Follow.follower_id == user.id)
        .order_by(Follow.created_at.desc())
    ).all()
    reverse_ids = set(
        session.scalars(select(Follow.follower_id).where(Follow.followed_id == user.id)).all()
    )
    return [
        FollowOut(
            user=_summary(session, session.get(User, follow.followed_id)),
            is_mutual=follow.followed_id in reverse_ids,
            followed_at=follow.created_at,
        )
        for follow in follows
    ]


@router.get("/api/v1/feed", response_model=list[ActivityOut])
def activity_feed(
    limit: int = Query(default=50, ge=1, le=100),
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[ActivityOut]:
    user = stored_user(session, current)
    if user is None:
        return []
    followed_ids = set(
        session.scalars(select(Follow.followed_id).where(Follow.follower_id == user.id)).all()
    )
    reverse_ids = set(
        session.scalars(select(Follow.follower_id).where(Follow.followed_id == user.id)).all()
    )
    mutual_ids = followed_ids & reverse_ids
    actor_ids = followed_ids | {user.id}
    events = session.scalars(
        select(ActivityEvent)
        .where(ActivityEvent.actor_user_id.in_(actor_ids))
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
        .limit(limit * 3)
    ).all()
    output: list[ActivityOut] = []
    for event in events:
        visible = (
            event.actor_user_id == user.id
            or event.visibility == "public"
            or (event.visibility == "friends" and event.actor_user_id in mutual_ids)
        )
        if not visible:
            continue
        actor = session.get(User, event.actor_user_id)
        if actor is None:
            continue
        course = None
        course_id = event.event_data.get("course_id")
        if isinstance(course_id, int):
            stored_course = session.get(Course, course_id)
            if stored_course is not None:
                course = course_data(stored_course)
        output.append(
            ActivityOut(
                id=event.id,
                event_type=event.event_type,
                actor=_summary(session, actor),
                course=course,
                data=event.event_data,
                created_at=event.created_at,
            )
        )
        if len(output) == limit:
            break
    return output
