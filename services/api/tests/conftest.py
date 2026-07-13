import pytest


@pytest.fixture(autouse=True)
def isolated_test_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep tests deterministic even when run inside the Docker API service."""

    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite://")
