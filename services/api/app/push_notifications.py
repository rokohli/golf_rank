import logging
from collections import defaultdict
from collections.abc import Sequence

import httpx
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .core.auth import CurrentUser, current_user
from .core.config import Settings
from .db import get_session
from .domain import require_user
from .models import AppNotification, OnboardingPreference, Profile, PushToken, User


logger = logging.getLogger("fairway.push")

router = APIRouter(tags=["push"])

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
    token: str
    platform: str | None = None


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
    else:
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
    recipient_ids = {notification.recipient_user_id for notification in notifications}
    tokens_by_recipient: dict[int, list[str]] = defaultdict(list)
    for token_row in session.scalars(select(PushToken).where(PushToken.user_id.in_(recipient_ids))):
        tokens_by_recipient[token_row.user_id].append(token_row.token)
    if not tokens_by_recipient:
        return

    actor_names = _actor_display_names(session, {notification.actor_user_id for notification in notifications})
    messages: list[dict[str, object]] = []
    message_tokens: list[str] = []
    for notification in notifications:
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
    try:
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
                # is skipped instead of raising past this delivery attempt,
                # which every caller has already committed its own work
                # before reaching.
                tickets = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(tickets, list):
                    continue
                for ticket, token in zip(tickets, batch_tokens):
                    if not isinstance(ticket, dict):
                        continue
                    details = ticket.get("details")
                    if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
                        invalid_tokens.add(token)
    except (httpx.HTTPError, OSError, ValueError, TypeError, AttributeError) as error:
        logger.error("push_delivery_failed error_type=%s", type(error).__name__)
        return

    if invalid_tokens:
        session.execute(delete(PushToken).where(PushToken.token.in_(invalid_tokens)))
        session.commit()
