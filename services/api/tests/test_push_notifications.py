import json

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import create_app
from app.models import PushToken


def _profile(client: TestClient, subject: str, first_name: str, username: str) -> dict[str, str]:
    headers = {"X-Development-Subject": subject}
    response = client.put(
        "/api/v1/me/onboarding-preferences",
        headers=headers,
        json={
            "home_region": "Monterey, CA",
            "max_green_fee": 700,
            "difficulty": "any",
            "access": "any",
            "onboarding_data": {
                "first_name": first_name,
                "last_name": "Golfer",
                "username": username,
                "home_course_search": "Pebble Beach",
                "travel_distance": "Any",
                "preferred_tee_time": "Morning",
            },
        },
    )
    assert response.status_code == 200
    return headers


def _mock_push_client(monkeypatch, handler):
    original_client = httpx.Client
    calls: list[list[dict]] = []

    def record_and_handle(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return handler(request)

    monkeypatch.setattr(
        "app.push_notifications.httpx.Client",
        lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(record_and_handle)),
    )
    return calls


def _ok_response(*, tickets: list[dict] | None = None) -> httpx.Response:
    payload_tickets = tickets if tickets is not None else [{"status": "ok"}]
    return httpx.Response(200, json={"data": payload_tickets})


def test_register_push_token_reassigns_ownership_on_reuse() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-alice", "Alice", "pushalice")
    bob = _profile(client, "dev:push-bob", "Bob", "pushbob")

    assert client.put("/api/v1/me/push-tokens", headers=alice, json={"token": "ExponentPushToken[shared]"}).status_code == 204
    with client.app.state.session_factory() as session:
        rows = session.scalars(select(PushToken).where(PushToken.token == "ExponentPushToken[shared]")).all()
        assert len(rows) == 1
        alice_user_id = rows[0].user_id

    # Same device, different account (sign out, sign back in as someone else).
    assert client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[shared]"}).status_code == 204
    with client.app.state.session_factory() as session:
        rows = session.scalars(select(PushToken).where(PushToken.token == "ExponentPushToken[shared]")).all()
        assert len(rows) == 1
        assert rows[0].user_id != alice_user_id


def test_unregister_push_token_removes_only_the_callers_row() -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-unreg-alice", "Alice", "pushunregalice")
    bob = _profile(client, "dev:push-unreg-bob", "Bob", "pushunregbob")
    client.put("/api/v1/me/push-tokens", headers=alice, json={"token": "ExponentPushToken[alice]"})
    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[bob]"})

    assert client.request(
        "DELETE", "/api/v1/me/push-tokens", headers=alice, params={"token": "ExponentPushToken[alice]"}
    ).status_code == 204

    with client.app.state.session_factory() as session:
        remaining = {row.token for row in session.scalars(select(PushToken)).all()}
        assert remaining == {"ExponentPushToken[bob]"}


def test_follow_notification_sends_exactly_one_push_and_no_second_on_refollow(monkeypatch) -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-follow-alice", "Alice", "pushfollowalice")
    bob = _profile(client, "dev:push-follow-bob", "Bob", "pushfollowbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushfollowbob"}).json()[0]["id"]

    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[bob-device]"})
    calls = _mock_push_client(monkeypatch, lambda request: _ok_response())

    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert len(calls) == 1
    [batch] = calls
    assert batch == [{"to": "ExponentPushToken[bob-device]", "sound": "default", "body": "Alice Golfer started following you"}]

    # Unfollow/refollow hits the same dedup path a plain re-follow would --
    # no second push for an already-notified relationship.
    assert client.delete(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 204
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert len(calls) == 1


def test_no_registered_token_means_no_push_attempt(monkeypatch) -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-notoken-alice", "Alice", "pushnotokenalice")
    bob = _profile(client, "dev:push-notoken-bob", "Bob", "pushnotokenbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushnotokenbob"}).json()[0]["id"]

    calls = _mock_push_client(monkeypatch, lambda request: _ok_response())
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert calls == []


def test_device_not_registered_ticket_deletes_the_token(monkeypatch) -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-stale-alice", "Alice", "pushstalealice")
    bob = _profile(client, "dev:push-stale-bob", "Bob", "pushstalebob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushstalebob"}).json()[0]["id"]

    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[stale]"})
    _mock_push_client(monkeypatch, lambda request: _ok_response(
        tickets=[{"status": "error", "message": "not registered", "details": {"error": "DeviceNotRegistered"}}]
    ))

    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    with client.app.state.session_factory() as session:
        remaining = session.scalars(select(PushToken).where(PushToken.token == "ExponentPushToken[stale]")).all()
        assert remaining == []


def test_push_delivery_failure_does_not_break_the_triggering_request(monkeypatch) -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-fail-alice", "Alice", "pushfailalice")
    bob = _profile(client, "dev:push-fail-bob", "Bob", "pushfailbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushfailbob"}).json()[0]["id"]

    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[fail]"})

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    original_client = httpx.Client
    monkeypatch.setattr(
        "app.push_notifications.httpx.Client",
        lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(handler)),
    )

    response = client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    assert response.status_code == 200
    with client.app.state.session_factory() as session:
        # A transport failure can't tell which tokens are bad, so nothing is deleted.
        remaining = session.scalars(select(PushToken).where(PushToken.token == "ExponentPushToken[fail]")).all()
        assert len(remaining) == 1


def test_tagging_a_companion_via_rating_details_sends_a_push(monkeypatch) -> None:
    # patch_rating_details (services/api/app/course_ratings.py) is a second,
    # separate entry point into _notify_tagged_companions besides
    # create_round/update_round -- it must dispatch push the same way they do.
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-details-alice", "Alice", "pushdetailsalice")
    bob = _profile(client, "dev:push-details-bob", "Bob", "pushdetailsbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushdetailsbob"}).json()[0]["id"]
    # Registers no token yet, so this unmocked follow has nothing to push to
    # (and can't accidentally prune a fake token via a real Expo response).
    client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    assert client.put(
        "/api/v1/me/course-ratings/1", headers=alice, json={"tier": "green", "played_on": "2026-07-01", "score": None}
    ).status_code == 200

    calls = _mock_push_client(monkeypatch, lambda request: _ok_response())
    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[details-bob]"})
    response = client.patch(
        "/api/v1/me/course-ratings/1/details",
        headers=alice,
        json={"friend_user_ids": [bob_id], "guest_names": [], "visibility": "friends"},
    )
    assert response.status_code == 200
    assert len(calls) == 1
    [batch] = calls
    assert batch == [{"to": "ExponentPushToken[details-bob]", "sound": "default", "body": "Alice Golfer tagged you in a round"}]


def test_disabling_notifications_prevents_push(monkeypatch) -> None:
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-disabled-alice", "Alice", "pushdisabledalice")
    bob = _profile(client, "dev:push-disabled-bob", "Bob", "pushdisabledbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushdisabledbob"}).json()[0]["id"]
    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[disabled]"})

    with client.app.state.session_factory() as session:
        from app.models import OnboardingPreference, User

        bob_record = session.scalar(select(User).where(User.provider_subject == "dev:push-disabled-bob"))
        preferences = session.get(OnboardingPreference, bob_record.id)
        preferences.onboarding_data = {**preferences.onboarding_data, "notifications": False}
        session.commit()

    calls = _mock_push_client(monkeypatch, lambda request: _ok_response())
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200
    assert calls == []
