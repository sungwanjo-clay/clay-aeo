-- Test for 002_snapshots_workspace_lookups.sql. Runs after 001_portfolio_test.sql on the same database.
\set ON_ERROR_STOP on
\pset footer off
-- clay-workflows got the new kinds from the migration:
select key_name, kinds from portfolio.ingest_keys where key_name = 'clay-workflows';
update portfolio.ingest_keys set kinds = kinds || '{snapshot_open,snapshot_close,workspace_lookups}' where key_name = 'clay-test';

\echo '== 1. week 1 (2026-11-30): open, lookups, eligibility; retries'
set role anon;
select public.portfolio_ingest('test-key', 'snapshot_open', '[{"snapshot_date":"2026-11-30"}]') as open1;
select public.portfolio_ingest('test-key', 'snapshot_open', '[{"snapshot_date":"2026-11-30"}]') as open1_retry;
\set lookups1 '[{"snapshot_date":"2026-11-30","domain":"lumenhq.com","lookup_status":"matched","workspaces":[{"workspace_id":"w1","match_method":"customers_domain","matched_value":"lumenhq.com","ever_paid":true,"paying_now":false},{"workspace_id":"w1","match_method":"creator_domain","matched_value":"lumenhq.com"},{"workspace_id":"w2","match_method":"creator_domain","matched_value":"lumenhq.com","ever_paid":false,"paying_now":false}]},{"snapshot_date":"2026-11-30","domain":"fernway.co","lookup_status":"no_exact_match","workspaces":[]},{"snapshot_date":"2026-11-30","domain":"tallyhq.com","lookup_status":"matched","workspaces":[{"workspace_id":"w9","match_method":"customers_domain"}]}]'
select public.portfolio_ingest('test-key', 'workspace_lookups', :'lookups1') as lookups1;
select public.portfolio_ingest('test-key', 'workspace_lookups', :'lookups1') as lookups1_retry;
select public.portfolio_ingest('test-key', 'workspace_lookups', '[
  {"snapshot_date":"2026-11-30","domain":"lumenhq.com","lookup_status":"matched","workspaces":[]},
  {"snapshot_date":"2026-11-30","domain":"fernway.co","lookup_status":"no_exact_match","workspaces":[{"workspace_id":"w5","match_method":"customers_domain"}]},
  {"snapshot_date":"2026-11-30","domain":"fernway.co","lookup_status":"matched","workspaces":[{"workspace_id":"w5","match_method":"guess"}]},
  {"snapshot_date":"2026-11-30","domain":"fernway.co","lookup_status":"zero"},
  {"snapshot_date":"2026-12-25","domain":"fernway.co","lookup_status":"failed"}]') as invalid_rows;
select public.portfolio_ingest('test-key', 'snapshots', '[{"snapshot_date":"2026-11-30","domain":"lumenhq.com","funding_fit":"fits","net_new_check":"pass"},
  {"snapshot_date":"2026-11-30","domain":"fernway.co","funding_fit":"fits","net_new_check":"needs_check"}]') as eligibility1;
reset role;
select count(*) as match_rows_week1 from portfolio.workspace_matches where snapshot_date = '2026-11-30';

\echo '== 2. close week 1; retry close; writes after close are refused'
set role anon;
select public.portfolio_ingest('test-key', 'snapshot_close', '[{"snapshot_date":"2026-11-30"}]') as close1;
select public.portfolio_ingest('test-key', 'snapshot_close', '[{"snapshot_date":"2026-11-30"}]') as close1_retry;
select public.portfolio_ingest('test-key', 'workspace_lookups', '[{"snapshot_date":"2026-11-30","domain":"fernway.co","lookup_status":"failed"}]') as lookup_after_close;
select public.portfolio_ingest('test-key', 'snapshots', '[{"snapshot_date":"2026-11-30","domain":"fernway.co","funding_fit":"fits","net_new_check":"pass"}]') as eligibility_after_close;

\echo '== 3. roster grows after week 1 closed (NewCo, first seen 2026-11-29): week 1 membership must not change'
select public.portfolio_ingest('test-key', 'roster', '[{"firm":"Y Combinator","source":"yc_directory","source_ref":"newco","company_name":"NewCo","domain":"newco.ai","verification_status":"verified","observed_at":"2026-11-29T12:00:00Z"}]') as roster_add;
reset role;
select snapshot_date, member_links, member_companies, lookups, status from dashboard.snapshots order by 1;

\echo '== 4. week 2 (2026-12-07): Lumen lookup failed, NewCo matched with paid flags unread'
set role anon;
select public.portfolio_ingest('test-key', 'snapshot_open', '[{"snapshot_date":"2026-12-07"}]') as open2;
select public.portfolio_ingest('test-key', 'workspace_lookups', '[
  {"snapshot_date":"2026-12-07","domain":"lumenhq.com","lookup_status":"failed","note":"warehouse timeout"},
  {"snapshot_date":"2026-12-07","domain":"newco.ai","lookup_status":"matched","workspaces":[{"workspace_id":"w7","match_method":"attribution_domain"}]}]') as lookups2;
select public.portfolio_ingest('test-key', 'snapshot_close', '[{"snapshot_date":"2026-12-07"}]') as close2;
reset role;

\echo '== 5. what the dashboard reads'
set role dashboard_sync;
select snapshot_date, status, member_links, member_companies, lookups, is_latest_complete from dashboard.snapshots order by 1;
select snapshot_date, f.name as firm, p.partnership_cut, portfolio, with_workspace, no_exact_match, workspace_unknown, ever_paid, paying_now, paying_unknown, eligible_to_date, redeemed, redemption_connected
from dashboard.firm_penetration p join dashboard.firms f using (firm_id) order by 1, 2;
select snapshot_date, cut, portfolio, with_workspace, no_exact_match, workspace_unknown, ever_paid, paying_now, paying_unknown, eligible_to_date, redeemed, redemption_connected
from dashboard.portfolio_totals order by 1, 2;
select c.snapshot_date, co.name, c.lookup_status, c.has_workspace, c.workspace_count, c.match_methods, c.ever_paid, c.paying_now, c.redemption_status, c.eligible_to_date
from dashboard.snapshot_companies c join dashboard.companies co using (company_id) order by 1, 2;
reset role;

\echo '== 6. reopen week 1 to redo it: membership refreezes as of 2026-11-30 (NewCo was first seen 11-29, so it joins)'
set role anon;
select public.portfolio_ingest('test-key', 'snapshot_open', '[{"snapshot_date":"2026-11-30","reopen":true}]') as reopen1;
select public.portfolio_ingest('test-key', 'snapshot_close', '[{"snapshot_date":"2026-11-30"}]') as reclose1;
reset role;
select snapshot_date, member_companies, reopened_count, status from dashboard.snapshots order by 1;

\echo '== 7. boundaries'
\set ON_ERROR_STOP off
set role anon;
select count(*) from dashboard.snapshot_companies;
select count(*) from portfolio.workspace_matches;
select jsonb_array_length(public.portfolio_export('read-key', 'portfolio_totals')->'rows') as export_totals_rows;
select public.portfolio_export('read-key', 'workspace_matches');
reset role;
set role dashboard_sync;
select count(*) from portfolio.workspace_matches;
select count(*) as sync_sees_snapshot_companies from dashboard.snapshot_companies;
reset role;
\set ON_ERROR_STOP on
select kind, reason, open_rows from dashboard.review_queue where kind in ('workspace_lookup', 'snapshot') order by 1, 2;
