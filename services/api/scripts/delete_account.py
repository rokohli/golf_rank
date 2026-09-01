#!/usr/bin/env python3
"""Delete a user's GolfRank account: their app data plus their Clerk identity.

For support requests that come in outside the app (email, App Store review
reply, etc.) where the user can't or won't use the in-app "Delete account"
button. Performs the same two steps as that button: delete the local `User`
row (which cascades to every table that references it) and delete the
matching Clerk user via the Backend API.

Usage:
    python -m scripts.delete_account clerk_abc123
    python -m scripts.delete_account clerk:clerk_abc123 --yes
    python -m scripts.delete_account clerk_abc123 --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException
from sqlalchemy import select

from app.core.auth import delete_clerk_user
from app.core.config import Settings
from app.db import make_engine, make_session_factory
from app.domain import lock_identity_transaction
from app.models import DeletedIdentity, User


def normalize_subject(raw: str) -> str:
    return raw if raw.startswith(("clerk:", "dev:")) else f"clerk:{raw}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("subject", help="Clerk user id (e.g. user_abc123), with or without the 'clerk:' prefix")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be deleted without deleting it")
    args = parser.parse_args()

    provider_subject = normalize_subject(args.subject)
    settings = Settings()
    settings.validate_security()

    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        lock_identity_transaction(session, provider_subject)
        stored_user = session.scalar(select(User).where(User.provider_subject == provider_subject))
        if stored_user is None:
            print(f"No local account found for {provider_subject}; will still attempt Clerk deletion.")
        else:
            print(f"Found local account: user_id={stored_user.id} provider_subject={provider_subject}")

        if args.dry_run:
            print("Dry run: no changes made.")
            return 0

        if not args.yes:
            confirmation = input(f"Permanently delete account {provider_subject}? Type 'delete' to confirm: ")
            if confirmation.strip().lower() != "delete":
                print("Aborted.")
                return 1

        if session.get(DeletedIdentity, provider_subject) is None:
            session.add(DeletedIdentity(provider_subject=provider_subject))
        if stored_user is not None:
            session.delete(stored_user)
            print("Deleted local account data.")
        session.commit()

        try:
            delete_clerk_user(provider_subject, settings)
        except HTTPException as exc:
            print(f"Local data deleted, but Clerk deletion failed ({exc.detail}); Clerk cleanup is pending.")
            return 1
        print("Deleted Clerk identity.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
