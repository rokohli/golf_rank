import json

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session as OrmSession, sessionmaker
from sqlalchemy.pool import QueuePool

from app.core.config import Settings
from app.main import create_app
from app.models import AppNotification, Base, PushToken, User
from app.push_notifications import send_push_notifications


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


# `app.push_notifications.httpx` is the same module object as `httpx` itself
# (module identity, not a copy), so patching "app.push_notifications.httpx.Client"
# mutates httpx.Client process-wide -- including for unrelated httpx.Client()
# construction elsewhere (e.g. create_app()'s WikimediaImageProvider). Always
# wrap from this fixed reference, captured once before any test patches it,
# rather than reading httpx.Client at call time: a test that calls this
# helper more than once (or that calls create_app() after an earlier call in
# the same test) would otherwise capture an already-wrapped Client and nest
# wrappers, each injecting its own `transport=` kwarg into the next.
_ORIGINAL_HTTPX_CLIENT = httpx.Client


def _mock_push_client(monkeypatch, handler):
    calls: list[list[dict]] = []

    def record_and_handle(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return handler(request)

    monkeypatch.setattr(
        "app.push_notifications.httpx.Client",
        lambda **kwargs: _ORIGINAL_HTTPX_CLIENT(**kwargs, transport=httpx.MockTransport(record_and_handle)),
    )
    return calls


def _ok_response(*, tickets: list[dict] | None = None) -> httpx.Response:
    payload_tickets = tickets if tickets is not None else [{"status": "ok"}]
    return httpx.Response(200, json={"data": payload_tickets})


def test_register_push_token_rejects_oversized_fields_with_a_validation_error_not_a_500() -> None:
    # PushToken.token/platform are String(255)/String(20); without a
    # matching bound here, an over-length value passes this validation and
    # then raises an uncaught DataError on the insert.
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-oversized-alice", "Alice", "pushoversizedalice")

    assert client.put(
        "/api/v1/me/push-tokens", headers=alice, json={"token": "x" * 256}
    ).status_code == 422
    assert client.put(
        "/api/v1/me/push-tokens", headers=alice, json={"token": "ExponentPushToken[ok]", "platform": "x" * 21}
    ).status_code == 422
    assert client.put(
        "/api/v1/me/push-tokens", headers=alice, json={"token": ""}
    ).status_code == 422


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


def test_register_push_token_retries_after_a_concurrent_registration_race(monkeypatch) -> None:
    # Two overlapping requests for the same brand-new token can both observe
    # existing is None and race to insert -- the unique constraint on token
    # then rejects the loser's commit. Without a retry, that surfaced as an
    # uncaught 500 and could leave the token owned by the "wrong" side of the
    # race with no reassignment ever applied. Simulates the interleaving
    # deterministically: intercept the endpoint's own existence check and
    # have a second, genuinely separate session win the insert first.
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-race-alice", "Alice", "pushracealice")
    _profile(client, "dev:push-race-bob", "Bob", "pushracebob")
    with client.app.state.session_factory() as setup_session:
        alice_id = setup_session.scalar(select(User.id).where(User.provider_subject == "dev:push-race-alice"))
        bob_id = setup_session.scalar(select(User.id).where(User.provider_subject == "dev:push-race-bob"))

    original_scalar = OrmSession.scalar
    intercepted = {"done": False}

    def racy_scalar(self, statement, *args, **kwargs):
        result = original_scalar(self, statement, *args, **kwargs)
        if not intercepted["done"] and "push_tokens" in str(statement).lower() and result is None:
            intercepted["done"] = True
            with client.app.state.session_factory() as racer:
                racer.add(PushToken(user_id=bob_id, token="ExponentPushToken[race]", platform="android"))
                racer.commit()
        return result

    monkeypatch.setattr(OrmSession, "scalar", racy_scalar)

    response = client.put("/api/v1/me/push-tokens", headers=alice, json={"token": "ExponentPushToken[race]"})
    assert response.status_code == 204

    with client.app.state.session_factory() as session:
        rows = session.scalars(select(PushToken).where(PushToken.token == "ExponentPushToken[race]")).all()
        # Exactly one row survives (no duplicate, no crash), reassigned to
        # whichever request's retry ran last -- here, alice's original call.
        assert len(rows) == 1
        assert rows[0].user_id == alice_id


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


def test_follow_notification_delivery_is_scheduled_as_a_background_task_not_called_inline(monkeypatch) -> None:
    # The point of run_push_delivery_task (vs. calling send_push_notifications
    # directly in the request handler) is that Expo delivery no longer
    # occupies the request-serving worker thread. Proves the wiring: the
    # endpoint hands off to run_push_delivery_task via BackgroundTasks with
    # the app instance and the newly created notification's id, rather than
    # delivering synchronously itself.
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-bgtask-alice", "Alice", "pushbgtaskalice")
    bob = _profile(client, "dev:push-bgtask-bob", "Bob", "pushbgtaskbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushbgtaskbob"}).json()[0]["id"]

    calls: list[tuple[object, list[int]]] = []

    def spy(app: object, notification_ids: list[int]) -> None:
        calls.append((app, notification_ids))

    monkeypatch.setattr("app.social.run_push_delivery_task", spy)

    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200

    assert len(calls) == 1
    scheduled_app, notification_ids = calls[0]
    assert scheduled_app is client.app
    with client.app.state.session_factory() as session:
        notification = session.get(AppNotification, notification_ids[0])
        assert notification is not None
        assert notification.notification_type == "followed_you"
        assert notification.recipient_user_id == session.scalar(
            select(User.id).where(User.provider_subject == "dev:push-bgtask-bob")
        )


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


def test_muted_actor_does_not_trigger_a_push_even_though_the_in_app_row_is_still_created(monkeypatch) -> None:
    # list_notifications hides a muted actor's rows from the in-app inbox
    # entirely; push delivery must honor the same exclusion, or muting
    # someone stops their activity from showing up in-app while their
    # pushes keep arriving anyway.
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-muted-alice", "Alice", "pushmutedalice")
    bob = _profile(client, "dev:push-muted-bob", "Bob", "pushmutedbob")
    alice_id = client.get("/api/v1/users", headers=bob, params={"q": "pushmutedalice"}).json()[0]["id"]
    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[muted-bob]"})
    assert client.put(f"/api/v1/me/mutes/{alice_id}", headers=bob).status_code == 204

    calls = _mock_push_client(monkeypatch, lambda request: _ok_response())
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushmutedbob"}).json()[0]["id"]
    assert client.put(f"/api/v1/me/follows/{bob_id}", headers=alice).status_code == 200

    assert calls == []
    in_app_items = client.get("/api/v1/me/notifications", headers=bob).json()["items"]
    assert in_app_items == []
    with client.app.state.session_factory() as session:
        # The row is created (creation-time checks only cover blocks, not
        # mutes) -- it's push delivery and the in-app read path that both
        # exclude it, not row creation.
        rows = session.scalars(select(AppNotification).where(AppNotification.notification_type == "followed_you")).all()
        assert len(rows) == 1


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


def test_malformed_expo_response_shapes_do_not_break_the_triggering_request(monkeypatch) -> None:
    # Expo is a third-party response; a malformed/unexpected body must be
    # skipped rather than raising past send_push_notifications -- the
    # triggering request has already committed its own work by this point.
    # One shared app/client for the whole test (created before any
    # monkeypatching) -- see _mock_push_client's note on why constructing a
    # second app under an active patch is unsafe.
    client = TestClient(create_app())
    for index, malformed_body in enumerate((
        {"data": None},
        {"data": [None]},
        {"data": ["not-a-dict"]},
        {"data": [{"status": "error", "details": None}]},
        {"data": "not-a-list"},
        "not-even-a-dict",
    )):
        alice = _profile(client, f"dev:push-malformed-alice-{index}", "Alice", f"pushmalformedalice{index}")
        bob = _profile(client, f"dev:push-malformed-bob-{index}", "Bob", f"pushmalformedbob{index}")
        bob_id = client.get("/api/v1/users", headers=alice, params={"q": f"pushmalformedbob{index}"}).json()[0]["id"]
        client.put("/api/v1/me/push-tokens", headers=bob, json={"token": f"ExponentPushToken[malformed{index}]"})
        _mock_push_client(monkeypatch, lambda request, body=malformed_body: httpx.Response(200, json=body))

        response = client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
        assert response.status_code == 200, malformed_body
        with client.app.state.session_factory() as session:
            # A response this malformed can't be trusted to identify which
            # token to prune, so the token is conservatively kept rather
            # than guessed-deleted.
            remaining = session.scalars(select(PushToken).where(PushToken.token == f"ExponentPushToken[malformed{index}]")).all()
            assert len(remaining) == 1, malformed_body


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


def test_database_failure_during_delivery_does_not_break_the_request_or_poison_the_session(monkeypatch) -> None:
    # Before this fix, only the httpx block was guarded -- a DB error in the
    # token/mute/name lookups (a pool timeout, a dropped connection) would
    # propagate uncaught, 500ing an endpoint whose own work had already
    # committed, and would leave the session mid-transaction for whatever
    # that endpoint does with it afterward (follow_user builds its response
    # body via _summary(session, ...) right after this call returns).
    client = TestClient(create_app())
    alice = _profile(client, "dev:push-dbfail-alice", "Alice", "pushdbfailalice")
    bob = _profile(client, "dev:push-dbfail-bob", "Bob", "pushdbfailbob")
    bob_id = client.get("/api/v1/users", headers=alice, params={"q": "pushdbfailbob"}).json()[0]["id"]
    client.put("/api/v1/me/push-tokens", headers=bob, json={"token": "ExponentPushToken[dbfail]"})

    def raise_db_error(*args: object, **kwargs: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection pool exhausted"))

    monkeypatch.setattr("app.push_notifications.muted_ids", raise_db_error)

    response = client.put(f"/api/v1/me/follows/{bob_id}", headers=alice)
    assert response.status_code == 200
    assert response.json()["user"]["id"] == bob_id


def test_send_push_notifications_releases_the_db_connection_before_contacting_expo(tmp_path, monkeypatch) -> None:
    # A StaticPool in-memory SQLite engine (used by TestClient(create_app()))
    # always hands back the same single connection, so it can't demonstrate
    # real pool checkout/checkin behavior. A file-backed engine with a real
    # QueuePool can: if the connection used for the token/name lookups is
    # still checked out while httpx.Client blocks on Expo, engine.pool
    # reports it, proving the fix (a mid-function session.commit()) actually
    # releases it back to the pool before the outbound call.
    engine = create_engine(f"sqlite:///{tmp_path / 'push.db'}", poolclass=QueuePool, pool_size=1, max_overflow=0)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    with session_factory() as setup_session:
        actor = User(provider_subject="dev:pool-actor")
        recipient = User(provider_subject="dev:pool-recipient")
        setup_session.add_all([actor, recipient])
        setup_session.flush()
        setup_session.add(PushToken(user_id=recipient.id, token="ExponentPushToken[pool]"))
        setup_session.commit()
        actor_id, recipient_id = actor.id, recipient.id

    checked_out_during_call: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        checked_out_during_call.append(engine.pool.checkedout())
        return httpx.Response(200, json={"data": [{"status": "ok"}]})

    original_client = httpx.Client
    monkeypatch.setattr(
        "app.push_notifications.httpx.Client",
        lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(handler)),
    )

    with session_factory() as session:
        notification = AppNotification(recipient_user_id=recipient_id, actor_user_id=actor_id, notification_type="followed_you")
        session.add(notification)
        session.commit()
        send_push_notifications(session, Settings(), [notification])

    assert checked_out_during_call == [0]


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
