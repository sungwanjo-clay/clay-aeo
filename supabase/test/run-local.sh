#!/usr/bin/env bash
# Applies 001_portfolio.sql to a throwaway local Postgres and runs the test. Usage: supabase/test/run-local.sh <workdir>
set -euo pipefail
W=${1:?workdir}; B=$(ls -d /usr/lib/postgresql/*/bin | tail -1); R=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$W/pgdata"; mkdir -p "$W"; cp "$R/migrations/001_portfolio.sql" "$R/test/001_portfolio_test.sql" "$W/"; chmod -R a+rwX "$W"
su postgres -c "$B/initdb -D $W/pgdata -A trust >/dev/null && $B/pg_ctl -D $W/pgdata -o '-k $W -p 55432 -c listen_addresses=' -l $W/pg.log start >/dev/null"
trap 'su postgres -c "$B/pg_ctl -D $W/pgdata stop -m fast >/dev/null"' EXIT
sleep 1
P="psql -h $W -p 55432 -U postgres -X -q"
$P -c "create role anon nologin; create role authenticated nologin; create schema extensions;"  # as on Supabase
$P -v ON_ERROR_STOP=1 -f "$W/001_portfolio.sql"
echo "migration applied"
$P -f "$W/001_portfolio_test.sql" 2>&1
