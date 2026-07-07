#!/usr/bin/env bash
# Starts (or stops) a throwaway pgvector/pg17 container for local integration
# tests: PA-023's DB adapters run their integration suite against this,
# gated on PASS_ALONG_TEST_DB_URL. Safe to run repeatedly; `stop` removes the
# container and its data.
set -euo pipefail

CONTAINER_NAME="pass-along-test-db"
HOST_PORT="55432"
IMAGE="pgvector/pgvector:pg17"
DB_NAME="pass_along_test"
DB_USER="postgres"
DB_PASSWORD="postgres"

export PASS_ALONG_TEST_DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}"

usage() {
  echo "Usage: $0 {start|stop|url}" >&2
  exit 1
}

wait_for_ready() {
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "postgres did not become ready in time" >&2
  exit 1
}

create_supabase_roles() {
  # A hosted Supabase project ships anon/authenticated/service_role by
  # default; a bare pgvector image doesn't, so the RLS policies in the
  # migrations (`to anon`, etc.) need these roles created before apply.
  docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
    do \$\$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end
    \$\$;
    grant usage on schema public to anon, authenticated, service_role;
  "
}

# GRANT SELECT is a table-level gate that RLS policies filter *after*; it has
# to run once the migrations have actually created the tables, so this runs
# after apply_migrations (unlike create_supabase_roles, which must run
# before, since `create policy ... to anon` needs the role to already exist).
grant_table_privileges() {
  docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
    grant select on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
  "
}

apply_migrations() {
  local migrations_dir
  migrations_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/migrations"

  for migration in "$migrations_dir"/000*.sql; do
    echo "applying $(basename "$migration")"
    docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$migration"
  done
}

start() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "removing existing $CONTAINER_NAME container"
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  echo "starting $CONTAINER_NAME on port $HOST_PORT"
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "${HOST_PORT}:5432" \
    "$IMAGE" >/dev/null

  wait_for_ready
  create_supabase_roles
  apply_migrations
  grant_table_privileges

  echo "PASS_ALONG_TEST_DB_URL=${PASS_ALONG_TEST_DB_URL}"
}

stop() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  echo "stopped and removed $CONTAINER_NAME"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  url) echo "$PASS_ALONG_TEST_DB_URL" ;;
  *) usage ;;
esac
