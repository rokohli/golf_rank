#!/usr/bin/env python3
"""Apply the R2 bucket lifecycle rule that expires unconfirmed course-photo
uploads out of course-photos/pending/ (see storage.py's module docstring and
build_storage_key/promote_storage_key for what this prefix split is for).

put_bucket_lifecycle_configuration REPLACES the whole lifecycle
configuration, not just this rule -- this script always reads the existing
configuration first and keeps any other rules already on the bucket,
merging or replacing only the rule with this script's ID.

Usage (run where the real R2_* env vars are set, e.g. inside the api
container -- see .env's own note that services/api/.env is not authoritative):
    python -m scripts.apply_r2_lifecycle_rule
    python -m scripts.apply_r2_lifecycle_rule --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boto3
from botocore.exceptions import ClientError

from app.core.config import Settings

RULE_ID = "expire-pending-course-photo-uploads"
PREFIX = "course-photos/pending/"
EXPIRE_AFTER_DAYS = 1


def _client(settings: Settings):
    missing = [
        name for name, value in [
            ("R2_ACCOUNT_ID", settings.r2_account_id),
            ("R2_ACCESS_KEY_ID", settings.r2_access_key_id),
            ("R2_SECRET_ACCESS_KEY", settings.r2_secret_access_key),
            ("R2_BUCKET_NAME", settings.r2_bucket_name),
        ] if not value
    ]
    if missing:
        raise SystemExit(f"Missing R2 configuration: {', '.join(missing)}")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    settings = Settings()
    client = _client(settings)
    bucket = settings.r2_bucket_name

    try:
        existing = client.get_bucket_lifecycle_configuration(Bucket=bucket)
        other_rules = [rule for rule in existing.get("Rules", []) if rule.get("ID") != RULE_ID]
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("NoSuchLifecycleConfiguration",):
            raise
        other_rules = []

    new_rule = {
        "ID": RULE_ID,
        "Filter": {"Prefix": PREFIX},
        "Status": "Enabled",
        "Expiration": {"Days": EXPIRE_AFTER_DAYS},
    }
    rules = [*other_rules, new_rule]

    print(f"Bucket: {bucket}")
    print(f"Existing other rules kept: {len(other_rules)}")
    print(f"Rule to apply: {new_rule}")

    if args.dry_run:
        print("--dry-run: not applying.")
        return

    client.put_bucket_lifecycle_configuration(
        Bucket=bucket,
        LifecycleConfiguration={"Rules": rules},
    )
    print("Applied.")

    confirm = client.get_bucket_lifecycle_configuration(Bucket=bucket)
    applied = next((rule for rule in confirm.get("Rules", []) if rule.get("ID") == RULE_ID), None)
    print(f"Verified rule now on bucket: {applied}")


if __name__ == "__main__":
    main()
