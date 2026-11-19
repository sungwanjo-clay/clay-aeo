-- Test for 003_header_auth_staging.sql. Runs after 002_test.sql on the same database.
\set ON_ERROR_STOP on
\pset footer off
select key_name, 'snapshot_discard' = any (kinds) as has_discard from portfolio.ingest_keys where key_name = 'clay-workflows';
update portfolio.ingest_keys set kinds = kinds || '{snapshot_discard}' where key_name = 'clay-test';

\echo '== 1. header auth: the key comes from x-portfolio-key (as PostgREST passes it), not the body'
begin; set local role anon;
select set_config('request.headers', '{"x-portfolio-key":"test-key","apikey":"pk"}', true);
select public.portfolio_ingest_h('snapshot_open', '[{"snapshot_date":"2026-12-14","staging":true}]') as open_staging;
commit;
\set ON_ERROR_STOP off
begin; set local role anon; select set_config('request.headers', '{"apikey":"pk"}', true);
select public.portfolio_ingest_h('snapshot_open', '[]') as no_header; rollback;
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"wrong"}', true);
select public.portfolio_ingest_h('snapshot_open', '[]') as wrong_key; rollback;
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"roster-key"}', true);
select public.portfolio_ingest_h('snapshot_open', '[]') as key_without_kind; rollback;
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"read-key"}', true);
select public.portfolio_ingest_h('roster', '[]') as read_key_cannot_write; rollback;
\set ON_ERROR_STOP on

\echo '== 2. staging week: write twice, close twice; never the latest week; can be discarded'
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"test-key"}', true);
\set lk '[{"snapshot_date":"2026-12-14","domain":"lumenhq.com","lookup_status":"matched","workspaces":[{"workspace_id":"w1","match_method":"customers_domain"}]},{"snapshot_date":"2026-12-14","domain":"newco.ai","lookup_status":"no_exact_match","workspaces":[]}]'
select public.portfolio_ingest_h('workspace_lookups', :'lk') as staging_lookups;
select public.portfolio_ingest_h('workspace_lookups', :'lk') as staging_lookups_retry;
select public.portfolio_ingest_h('snapshot_close', '[{"snapshot_date":"2026-12-14"}]') as close_staging;
select public.portfolio_ingest_h('snapshot_close', '[{"snapshot_date":"2026-12-14"}]') as close_staging_retry;
select public.portfolio_ingest_h('snapshot_open', '[{"snapshot_date":"2026-12-14"}]') as production_open_on_staging_date;
select public.portfolio_ingest_h('snapshot_discard', '[{"snapshot_date":"2026-12-07"}]') as discard_production_refused;
commit;
select snapshot_date, status, is_staging, member_companies, lookups, is_latest_complete from dashboard.snapshots order by 1;
select count(*) as staging_lookup_rows from portfolio.workspace_lookups where snapshot_date = '2026-12-14';
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"test-key"}', true);
select public.portfolio_ingest_h('snapshot_discard', '[{"snapshot_date":"2026-12-14"}]') as discard_staging;
commit;
select snapshot_date, is_staging from dashboard.snapshots order by 1;
select count(*) as rows_left_for_staging_date from portfolio.workspace_lookups where snapshot_date = '2026-12-14';

\echo '== 3. the body-key entry point still works'
set role anon;
select public.portfolio_ingest('test-key', 'snapshot_open', '[{"snapshot_date":"2026-12-07"}]') as body_key_still_works;
reset role;
