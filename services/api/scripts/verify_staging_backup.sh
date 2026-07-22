#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 1
fi

backup_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [[ ! -f "$backup_path" ]]; then
  echo "Backup not found: $backup_path" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_dir="$(cd "$script_dir/.." && pwd)"
container_name="fairway-restore-verify-$$"
database_name="fairway_restore"
database_user="fairway_restore"
database_password="restore-only-password"

cleanup() {
  docker stop "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --detach \
  --name "$container_name" \
  --platform "${DOCKER_PLATFORM:-linux/amd64}" \
  --env POSTGRES_DB="$database_name" \
  --env POSTGRES_USER="$database_user" \
  --env POSTGRES_PASSWORD="$database_password" \
  --publish 127.0.0.1::5432 \
  postgis/postgis:17-3.5-alpine >/dev/null

host_port="$(docker port "$container_name" 5432/tcp | awk -F: '{print $NF}')"
restore_url="postgresql+psycopg://$database_user:$database_password@127.0.0.1:$host_port/$database_name"
native_restore_url="postgresql://$database_user:$database_password@127.0.0.1:$host_port/$database_name"

for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p "$host_port" -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pg_isready -h 127.0.0.1 -p "$host_port" -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
  echo "Restore database did not become ready." >&2
  exit 1
fi

(
  cd "$api_dir"
  DATABASE_URL="$restore_url" alembic upgrade head
)

pg_restore \
  --dbname="$native_restore_url" \
  --data-only \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$backup_path"

DATABASE_URL="$restore_url" python - <<'PY'
from sqlalchemy import create_engine, func, select

from app.models import Course, User

engine = create_engine(__import__("os").environ["DATABASE_URL"])
with engine.connect() as connection:
    course_count = connection.scalar(select(func.count()).select_from(Course))
    user_count = connection.scalar(select(func.count()).select_from(User))

if not course_count:
    raise SystemExit("Restore verification failed: no courses were restored.")

print(f"Restore verified: courses={course_count}, users={user_count}")
PY
