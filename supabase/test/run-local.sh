#!/usr/bin/env bash
# Applies 001, runs its test, applies 002 on top of that data and runs its test, on a throwaway local Postgres and runs the test. Usage: supabase/test/run-local.sh <workdir>
set -euo pipefail
W=${1:?workdir}; B=$(ls -d /usr/lib/postgresql/*/bin | tail -1); R=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$W/pgdata"; mkdir -p "$W"; cp "$R"/migrations/*.sql "$R"/test/*.sql "$W/"; chmod -R a+rwX "$W"
su postgres -c "$B/initdb -D $W/pgdata -A trust >/dev/null && $B/pg_ctl -D $W/pgdata -o '-k $W -p 55432 -c listen_addresses=' -l $W/pg.log start >/dev/null"
trap 'su postgres -c "$B/pg_ctl -D $W/pgdata stop -m fast >/dev/null"' EXIT
sleep 1
P="psql -h $W -p 55432 -U postgres -X -q"
$P -c "create role anon nologin; create role authenticated nologin; create schema extensions;"  # as on Supabase
$P -v ON_ERROR_STOP=1 -f "$W/001_portfolio.sql"
echo "migration applied"
$P -f "$W/001_portfolio_test.sql" > "$W/001.out" 2>&1 && echo "001 test ran (output in $W/001.out)"
$P -c "insert into portfolio.ingest_keys (key_name, key_hash, kinds) values ('clay-workflows', extensions.crypt('cw', extensions.gen_salt('bf')), '{firms,roster,snapshots,runs}')"
$P -v ON_ERROR_STOP=1 -f "$W/002_snapshots_workspace_lookups.sql"
echo "002 applied on top of 001 data"
$P -f "$W/002_test.sql" > "$W/002.out" 2>&1 && echo "002 test ran (output in $W/002.out)"
$P -v ON_ERROR_STOP=1 -f "$W/003_header_auth_staging.sql"
echo "003 applied"
$P -f "$W/003_test.sql" > "$W/003.out" 2>&1 && echo "003 test ran (output in $W/003.out)"
$P -v ON_ERROR_STOP=1 -f "$W/004_incremental_state.sql"
echo "004 applied"
$P -f "$W/004_test.sql" 2>&1
$P -v ON_ERROR_STOP=1 -f "$W/005_week_end_membership.sql" && echo "005 applied"
$P -v ON_ERROR_STOP=1 -f "$W/006_paying_arr.sql" && echo "006 applied"
$P -f "$W/006_test.sql" 2>&1
sed -i "/alter role anon/d; /notify pgrst/d" "$W/007_ingest_timeout.sql"; $P -v ON_ERROR_STOP=1 -f "$W/007_ingest_timeout.sql" && echo "007 applied"
