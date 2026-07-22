#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
backup_dir="${BACKUP_DIR:-$repo_root/.backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/fairway-staging-data-$timestamp.dump"
dump_url="${DATABASE_URL/postgresql+psycopg:/postgresql:}"

umask 077
mkdir -p "$backup_dir"

pg_dump \
  --dbname="$dump_url" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --enable-row-security \
  --schema=public \
  --exclude-table=public.alembic_version \
  --file="$backup_path"

chmod 600 "$backup_path"
checksum="$(shasum -a 256 "$backup_path" | awk '{print $1}')"

echo "Backup: $backup_path"
echo "SHA-256: $checksum"
