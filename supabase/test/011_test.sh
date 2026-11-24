#!/usr/bin/env bash
# Test for 011: two writers of the same company's lookup at once both succeed (run-local.sh calls this after 011).
# Writer A holds its transaction open for 3 s; writer B starts 1 s later on the same company. Before 011, B failed with
# duplicate key on workspace_lookups_pkey; now B waits, then updates. Usage: 011_test.sh "<psql command>"
set -uo pipefail
P=$1
$P -v ON_ERROR_STOP=1 -At -c "select portfolio.ingest_snapshot_open('[{\"snapshot_date\":\"2027-01-04\",\"reopen\":true}]')" >/dev/null
DOM=$($P -At -c "select ci.value from portfolio.company_firms cf join portfolio.company_identifiers ci on ci.company_id = cf.company_id and ci.id_type = 'domain' where cf.verification_status = 'verified' limit 1")
$P -At -c "delete from portfolio.workspace_lookups l using portfolio.company_identifiers ci where ci.company_id = l.company_id and ci.value = '$DOM' and l.snapshot_date = '2027-01-04'"
row() { echo "[{\"snapshot_date\":\"2027-01-04\",\"domain\":\"$DOM\",\"lookup_status\":\"matched\",\"paying_arr_usd\":$1,\"workspaces\":[{\"workspace_id\":\"$2\",\"match_method\":\"creator_domain\",\"paying_now\":true,\"ever_paid\":true}]}]"; }
($P -v ON_ERROR_STOP=1 -At -c "begin; select portfolio.ingest_workspace_lookups('$(row 100 wa)'); select pg_sleep(3); commit;" > /tmp/011a.out 2>&1; echo "a=$?" >> /tmp/011a.out) &
sleep 1
$P -v ON_ERROR_STOP=1 -At -c "select portfolio.ingest_workspace_lookups('$(row 200 wb)')" > /tmp/011b.out 2>&1; B=$?
wait
echo "== 011: concurrent writes of one company"
echo "writer A: $(tr '\n' ' ' < /tmp/011a.out)"
echo "writer B: exit $B $(tr '\n' ' ' < /tmp/011b.out)"
$P -At -c "select 'row: arr=' || l.paying_arr_usd || ' matches=' || (select string_agg(workspace_id, ',') from portfolio.workspace_matches m where m.snapshot_date = l.snapshot_date and m.company_id = l.company_id)
  from portfolio.workspace_lookups l join portfolio.company_identifiers ci on ci.company_id = l.company_id and ci.value = '$DOM' where l.snapshot_date = '2027-01-04'"
[ "$B" = 0 ] && grep -q "a=0" /tmp/011a.out && echo "011 PASS: both writers succeeded, last write kept" || { echo "011 FAIL"; exit 1; }
