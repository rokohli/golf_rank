from app.db import make_engine, make_session_factory
from app.models import Base, FailedObjectDeletion
from app.storage import ObjectMeta, ObjectStorage, PresignedUpload
from scripts.retry_failed_object_deletions import retry_rows, rows_to_retry


class _PartiallyFailingStorage(ObjectStorage):
    def __init__(self, *, succeeds: set[str]) -> None:
        self.succeeds = succeeds
        self.attempted: list[str] = []

    def create_course_photo_upload(self, *, course_id: int, content_type: str, expires_in_seconds: int) -> PresignedUpload | None:
        raise NotImplementedError

    def head_object(self, storage_key: str) -> ObjectMeta | None:
        raise NotImplementedError

    def delete_object(self, storage_key: str) -> bool:
        self.attempted.append(storage_key)
        return storage_key in self.succeeds

    def promote_object(self, pending_key: str, permanent_key: str) -> None:
        raise NotImplementedError


def _session_factory():
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


def test_retry_rows_removes_succeeded_and_keeps_failed_with_bumped_attempts() -> None:
    session_factory = _session_factory()
    with session_factory() as session:
        session.add_all([
            FailedObjectDeletion(storage_key="course-photos/1/ok.jpg", context="round_delete"),
            FailedObjectDeletion(storage_key="course-photos/1/still-broken.jpg", context="account_delete"),
        ])
        session.commit()

        storage = _PartiallyFailingStorage(succeeds={"course-photos/1/ok.jpg"})
        rows = rows_to_retry(session, 100)
        succeeded = retry_rows(session, storage, rows)

        assert succeeded == 1
        assert set(storage.attempted) == {"course-photos/1/ok.jpg", "course-photos/1/still-broken.jpg"}

        remaining = rows_to_retry(session, 100)
        assert [row.storage_key for row in remaining] == ["course-photos/1/still-broken.jpg"]
        assert remaining[0].attempts == 1
        assert remaining[0].last_attempted_at is not None


def test_retry_rows_respects_the_limit() -> None:
    session_factory = _session_factory()
    with session_factory() as session:
        session.add_all([
            FailedObjectDeletion(storage_key=f"course-photos/1/{i}.jpg", context="round_delete")
            for i in range(5)
        ])
        session.commit()

        storage = _PartiallyFailingStorage(succeeds=set())
        rows = rows_to_retry(session, 2)

        assert len(rows) == 2
