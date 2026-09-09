#!/usr/bin/env python3
"""Retry R2 deletions recorded in failed_object_deletions.

round/account deletion records a row here whenever storage.delete_object()
returns False for an already-promoted (permanent) storage_key -- unlike a
pending-prefixed key, a permanent object isn't covered by the R2 lifecycle
rule and has no CourseImage row left to retry from once the owning
transaction commits, so a delete failure at that point would otherwise be
lost forever. This script retries each recorded key and removes the row
once its deletion actually succeeds.

Usage:
    python -m scripts.retry_failed_object_deletions
    python -m scripts.retry_failed_object_deletions --dry-run
    python -m scripts.retry_failed_object_deletions --limit 200
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.core.config import Settings
from app.db import make_engine, make_session_factory
from app.models import FailedObjectDeletion
from app.storage import ObjectStorage, build_object_storage


def rows_to_retry(session, limit: int) -> list[FailedObjectDeletion]:
    return list(session.scalars(
        select(FailedObjectDeletion).order_by(FailedObjectDeletion.created_at).limit(limit)
    ).all())


def retry_rows(session, storage: ObjectStorage, rows: list[FailedObjectDeletion]) -> int:
    """Retries each row's deletion, removing it on success and leaving it (with
    attempts/last_attempted_at bumped) for the next run on continued failure.
    Commits once at the end. Returns how many succeeded."""
    succeeded = 0
    for row in rows:
        row.attempts += 1
        row.last_attempted_at = datetime.now(timezone.utc)
        if storage.delete_object(row.storage_key):
            session.delete(row)
            succeeded += 1
    session.commit()
    return succeeded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=100, help="Maximum rows to retry in one run")
    parser.add_argument("--dry-run", action="store_true", help="List target rows without deleting or writing")
    args = parser.parse_args()

    settings = Settings()
    storage = build_object_storage(settings)
    if storage is None:
        print("Object storage is not configured; nothing to do.")
        return 0

    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine, course_image_base_url=settings.course_image_base_url)

    with session_factory() as session:
        rows = rows_to_retry(session, args.limit)
        if not rows:
            print("No failed deletions to retry.")
            return 0

        print(f"{len(rows)} row(s) targeted:")
        for row in rows:
            print(f"  #{row.id} {row.storage_key} (context={row.context}, attempts={row.attempts})")

        if args.dry_run:
            print("\nDry run: no deletions attempted, no rows written.")
            return 0

        succeeded = retry_rows(session, storage, rows)
        print(f"\n{succeeded}/{len(rows)} succeeded and were removed; the rest remain for the next run.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
