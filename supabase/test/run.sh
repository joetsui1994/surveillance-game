#!/usr/bin/env bash
# Test supabase/schema.sql on a throwaway local Postgres (needs initdb/pg_ctl/psql, e.g. `brew install postgresql`).
# Usage: npm run test:sql
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="$(mktemp -d)"
port=54329
trap 'pg_ctl -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"' EXIT
initdb -D "$data" -U postgres -A trust >/dev/null
pg_ctl -D "$data" -o "-p $port -k '' -c wal_level=logical" -l "$data/log" -w start >/dev/null
psql=(psql -h 127.0.0.1 -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${psql[@]}" -f "$here/prelude.sql"
"${psql[@]}" -f "$here/../schema.sql" >/dev/null 2>&1   # applied twice: it must be re-runnable
"${psql[@]}" -f "$here/../schema.sql" 2>&1 | grep -v NOTICE || true
"${psql[@]}" -f "$here/checks.sql" >/dev/null
echo "All schema checks passed."
