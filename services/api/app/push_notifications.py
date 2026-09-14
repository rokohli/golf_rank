import logging
import threading
from collections import defaultdict
from collections.abc import Sequence

import httpx
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.config import Settings
from .db import get_session
from .domain import blocked_ids, muted_ids, notifications_enabled, require_user
from .models import AppNotification, OnboardingPreference, Profile, PushToken, User


logger = logging.getLogger("fairway.push")

router = APIRouter(tags=["push"])

# Bounds concurrent Expo delivery attempts from the request process, mirroring
# course_photo_scoring_job.py's _scoring_slots: BackgroundTasks for a sync
# callable still runs on Starlette's shared AnyIO worker threadpool -- the
# same one sync route handlers use -- so an unbounded number of concurrent
# deliveries could still exhaust it during an Expo slowdown even though
# delivery no longer runs on the *triggering* request's own thread. Acquired
# non-blocking: there is no retry/queue for a skipped push (matches this
# feature's existing best-effort framing), so a batch that can't get a slot
# is simply dropped rather than queuing threads behind a slow outbound call.
_delivery_slots: threading.Semaphore | None = None
_delivery_slots_lock = threading.Lock()


def _slots(settings: Settings) -> threading.Semaphore:
    global _delivery_slots
    with _delivery_slots_lock:
        if _delivery_slots is None:
            _delivery_slots = threading.Semaphore(settings.push_delivery_max_concurrent)
        return _delivery_slots

# Deliberately generic per notification_type: never derived from a private
# note, round detail, or other content the recipient hasn't already made
# visible to the actor. Types with no template (e.g. any future in-app-only
# type) are silently skipped rather than sent with a made-up body.
_MESSAGE_TEMPLATES = {
    "followed_you": "{actor} started following you",
    "mutual_follow": "You and {actor} are now mutual follows",
    "reacted_to_round": "{actor} reacted to your round",
    "tagged_in_round": "{actor} tagged you in a round",
    "contact_joined": "{actor} joined Fairway",
}

# Expo's push API accepts at most 100 messages per request.
_EXPO_BATCH_SIZE = 100


class PushTokenIn(BaseModel):
    # Bounded to match PushToken.token/platform (String(255)/String(20)) --
    # without this, an over-length value passes validation here and then
    # raises an uncaught DataError on insert/update, 500ing instead of
    # returning a normal validation error.
    token: str = Field(min_length=1, max_length=255)
    platform: str | None = Field(default=None, max_length=20)


@router.put("/api/v1/me/push-tokens", status_code=204)
def register_push_token(
    payload: PushTokenIn,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current, create=True)
    existing = session.scalar(select(PushToken).where(PushToken.token == payload.token))
    if existing is None:
        session.add(PushToken(user_id=user.id, token=payload.token, platform=payload.platform))
        try:
            session.commit()
            return Response(status_code=204)
        except IntegrityError:
            # Lost a race with a concurrent registration of the same
            # brand-new token (e.g. a retry racing the original request) --
            # the other request's insert already landed on `token`'s unique
            # constraint. Roll back and fall through to the reassign path
            # below instead of 500ing a request that should just win or
            # lose the same way the existing-token branch already does.
            session.rollback()
            existing = session.scalar(select(PushToken).where(PushToken.token == payload.token))
    if existing is not None:
        # A device can be reused across accounts (sign out, sign back in as
        # someone else) -- reassign rather than reject, so the old owner
        # stops receiving pushes meant for the new one.
        existing.user_id = user.id
        existing.platform = payload.platform
        existing.last_seen_at = func.now()
    session.commit()
    return Response(status_code=204)


@router.delete("/api/v1/me/push-tokens", status_code=204)
def unregister_push_token(
    token: str,
    current: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    user = require_user(session, current)
    session.execute(delete(PushToken).where(PushToken.user_id == user.id, PushToken.token == token))
    session.commit()
    return Response(status_code=204)


def _actor_display_names(session: Session, actor_ids: set[int]) -> dict[int, str]:
    if not actor_ids:
        return {}
    rows = session.execute(
        select(User.id, OnboardingPreference.onboarding_data, Profile.username)
        .select_from(User)
        .outerjoin(OnboardingPreference, OnboardingPreference.user_id == User.id)
        .outerjoin(Profile, Profile.user_id == User.id)
        .where(User.id.in_(actor_ids))
    ).all()
    names: dict[int, str] = {}
    for user_id, onboarding_data, username in rows:
        onboarding = onboarding_data or {}
        display_name = " ".join(
            item for item in (onboarding.get("first_name"), onboarding.get("last_name")) if item
        ).strip()
        names[user_id] = display_name or username or f"Golfer {user_id}"
    return names


def send_push_notifications(session: Session, settings: Settings, notifications: Sequence[AppNotification]) -> None:
    """Best-effort push delivery for freshly created notifications.

    Called only with notifications that were actually just inserted (never
    ones deduped away by the existing per-type unique index), so one call
    here is naturally one push per event -- callers don't need their own
    idempotency tracking. Never raises: a push failure must not fail the
    request (follow/react/tag/etc.) that triggered it.
    """
    if not notifications:
        return
    # Everything below touches the database or the network on behalf of an
    # endpoint that has already committed its own work -- a failure here
    # (a pool timeout, a transient Expo/HTTP error, a malformed Expo
    # response) must never propagate past this function. A DB-layer error
    # additionally needs an explicit rollback: left mid-transaction, it
    # would poison the caller's session for any query it runs afterward
    # (e.g. follow_user's _summary() call right after this returns), not
    # just this function's own return value.
    try:
        # list_notifications (social.py) hides any row whose actor the
        # recipient has muted or blocked from the in-app inbox, and returns
        # nothing at all for a recipient who has notifications disabled.
        # Push delivery has to honor the same exclusions -- and re-check
        # them here rather than trusting the creation-time checks, because
        # delivery now runs as a BackgroundTask after the triggering
        # request has already committed and returned: the recipient has a
        # real window to block the actor or flip notifications off between
        # the row being created and this function running. Re-fetched per
        # recipient (not per notification) and cached, since one batch can
        # cover several recipients (e.g. tagging multiple companions on one
        # round) but re-checking the same recipient twice would be wasted
        # work.
        muted_ids_by_recipient: dict[int, set[int]] = {}
        blocked_ids_by_recipient: dict[int, set[int]] = {}
        notifications_enabled_by_recipient: dict[int, bool] = {}

        def is_deliverable(recipient_id: int, actor_id: int) -> bool:
            if recipient_id not in notifications_enabled_by_recipient:
                notifications_enabled_by_recipient[recipient_id] = notifications_enabled(session, recipient_id)
            if not notifications_enabled_by_recipient[recipient_id]:
                return False
            if recipient_id not in muted_ids_by_recipient:
                muted_ids_by_recipient[recipient_id] = muted_ids(session, recipient_id)
            if actor_id in muted_ids_by_recipient[recipient_id]:
                return False
            if recipient_id not in blocked_ids_by_recipient:
                blocked_ids_by_recipient[recipient_id] = blocked_ids(session, recipient_id)
            if actor_id in blocked_ids_by_recipient[recipient_id]:
                return False
            return True

        filtered_notifications = [
            notification for notification in notifications
            if is_deliverable(notification.recipient_user_id, notification.actor_user_id)
        ]
        if not filtered_notifications:
            return

        recipient_ids = {notification.recipient_user_id for notification in filtered_notifications}
        tokens_by_recipient: dict[int, list[str]] = defaultdict(list)
        for token_row in session.scalars(select(PushToken).where(PushToken.user_id.in_(recipient_ids))):
            tokens_by_recipient[token_row.user_id].append(token_row.token)
        if not tokens_by_recipient:
            return

        actor_names = _actor_display_names(session, {notification.actor_user_id for notification in filtered_notifications})
        messages: list[dict[str, object]] = []
        message_tokens: list[str] = []
        for notification in filtered_notifications:
            tokens = tokens_by_recipient.get(notification.recipient_user_id)
            template = _MESSAGE_TEMPLATES.get(notification.notification_type)
            if not tokens or template is None:
                continue
            body = template.format(actor=actor_names.get(notification.actor_user_id, "Someone"))
            for token in tokens:
                messages.append({"to": token, "sound": "default", "body": body})
                message_tokens.append(token)
        if not messages:
            return

        # All data needed for delivery is now in plain Python values above --
        # release this connection back to the pool before the synchronous,
        # potentially multi-second Expo call, rather than holding it for the
        # duration of an outbound network request. (Read-only: nothing to lose.)
        session.commit()

        invalid_tokens: set[str] = set()
        with httpx.Client(timeout=settings.expo_push_timeout_seconds) as client:
            for start in range(0, len(messages), _EXPO_BATCH_SIZE):
                batch = messages[start:start + _EXPO_BATCH_SIZE]
                batch_tokens = message_tokens[start:start + _EXPO_BATCH_SIZE]
                response = client.post(settings.expo_push_api_url, json=batch)
                response.raise_for_status()
                payload = response.json()
                # Expo is expected to return {"data": [ticket, ...]}, but this
                # is a third-party response -- validate the shape explicitly
                # rather than trusting it, so a malformed/unexpected body
                # (e.g. {"data": null}, a non-dict ticket, "details": null)
                # is skipped instead of raising past this delivery attempt.
                tickets = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(tickets, list):
                    continue
                for ticket, token in zip(tickets, batch_tokens):
                    if not isinstance(ticket, dict):
                        continue
                    details = ticket.get("details")
                    if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
                        invalid_tokens.add(token)

        if invalid_tokens:
            session.execute(delete(PushToken).where(PushToken.token.in_(invalid_tokens)))
            session.commit()
    except (SQLAlchemyError, httpx.HTTPError, OSError, ValueError, TypeError, AttributeError) as error:
        if isinstance(error, SQLAlchemyError):
            session.rollback()
        logger.error("push_delivery_failed error_type=%s", type(error).__name__)


def run_push_delivery_task(app, notification_ids: Sequence[int]) -> None:
    """BackgroundTask entry point (mirrors run_scoring_task in
    course_photo_scoring_job.py). Opens its own session -- the request's
    session is closed by the time a background task runs -- so delivery no
    longer holds up the *triggering* request's own response.

    That alone isn't enough: BackgroundTasks for a sync callable still runs
    on Starlette's shared AnyIO worker threadpool, the same one sync route
    handlers use to run at all. Enough concurrent notification writes could
    still exhaust that shared pool during an Expo slowdown and stall
    unrelated requests, even though none of them are individually blocked
    waiting on this one. The non-blocking semaphore below bounds how many
    deliveries can occupy that pool at once; anything past the bound is
    dropped rather than queued, matching this feature's existing
    best-effort, no-retry framing.

    Re-fetches notifications by ID rather than reusing the caller's ORM
    objects, since those belong to a session that's gone by the time this
    runs.
    """
    if not notification_ids:
        return
    settings = app.state.settings
    slots = _slots(settings)
    if not slots.acquire(blocking=False):
        logger.info("push_delivery_deferred notification_count=%s reason=busy", len(notification_ids))
        return
    try:
        with app.state.session_factory() as session:
            notifications = session.scalars(
                select(AppNotification).where(AppNotification.id.in_(notification_ids))
            ).all()
            send_push_notifications(session, settings, notifications)
    finally:
        slots.release()
