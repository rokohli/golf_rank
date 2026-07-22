from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.main import create_app


def test_health_returns_ok_with_request_id() -> None:
    response = TestClient(create_app()).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]


def test_readiness_checks_database_connection() -> None:
    response = TestClient(create_app()).get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_fails_when_database_is_unavailable() -> None:
    class UnavailableSession:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _statement):
            raise OperationalError("SELECT 1", {}, RuntimeError("offline"))

    app = create_app()
    app.state.session_factory = UnavailableSession
    response = TestClient(app).get("/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


def test_readiness_caches_successful_database_checks() -> None:
    class CountingSession:
        executions = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _statement):
            type(self).executions += 1

    app = create_app()
    app.state.session_factory = CountingSession
    client = TestClient(app)

    assert client.get("/ready").status_code == 200
    assert client.get("/ready").status_code == 200
    assert CountingSession.executions == 1
