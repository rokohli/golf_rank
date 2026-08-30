"""Cloudflare R2 object storage (S3-compatible)."""

import boto3
from botocore.config import Config

from .core.config import Settings


def make_r2_client(settings: Settings):
    if not (settings.r2_account_id and settings.r2_access_key_id and settings.r2_secret_access_key):
        raise ValueError("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_object(client, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
