import pytest


@pytest.fixture(autouse=True)
def isolated_test_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep tests deterministic even when run inside the Docker API service."""

    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite://")
    # wikimedia_live_lookup_enabled defaults to True in production; tests that
    # want to exercise a live lookup construct Settings(wikimedia_live_lookup_enabled=True)
    # explicitly (an explicit kwarg overrides this env var). Without this,
    # every course-detail request in the suite would attempt a real network
    # call to Wikimedia Commons.
    monkeypatch.setenv("WIKIMEDIA_LIVE_LOOKUP_ENABLED", "false")
