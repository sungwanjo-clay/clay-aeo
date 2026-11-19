-- Test for 005 + 006 (week-end membership, paying ARR). Runs after 004_test.sql on the same database.
\set ON_ERROR_STOP on
\pset footer off
\echo '== 006: ARR rides on the workspace lookup and sums per firm and cut'
-- a verified company with counting evidence from the earlier tests
select c.company_id, ci.value as domain into temp t from portfolio.company_firms cf join portfolio.companies c using (company_id)
  join portfolio.company_identifiers ci on ci.company_id = c.company_id and ci.id_type = 'domain'
  join portfolio.relationship_evidence e using (relationship_id) join portfolio.sources s on s.source = e.source and s.counts_toward_denominator
  where cf.verification_status = 'verified' limit 2;
select count(*) as test_companies from t;
select jsonb_agg(jsonb_build_object('snapshot_date','2027-01-04','domain',domain,'lookup_status','matched',
  'paying_arr_usd', 12000 + rn,'workspaces', jsonb_build_array(jsonb_build_object('workspace_id','w'||rn,'match_method','creator_domain','paying_now',true,'ever_paid',true))))::text as rows
  from (select domain, row_number() over () as rn from t) z \gset
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"test-key"}', true);
select public.portfolio_ingest_h('snapshot_open', '[{"snapshot_date":"2027-01-04"}]') as opened;
select public.portfolio_ingest_h('workspace_lookups', :'rows'::jsonb) as lookups;
select public.portfolio_ingest_h('snapshot_close', '[{"snapshot_date":"2027-01-04"}]') as closed;
commit;
select company_id in (select company_id from t) as test_company, paying_now, paying_arr_usd from dashboard.snapshot_companies where snapshot_date = '2027-01-04' order by paying_arr_usd nulls last limit 5;
select cut, portfolio, paying_now, paying_arr_usd, paying_arr_unknown from dashboard.portfolio_totals where snapshot_date = '2027-01-04' order by cut;
select firm_id is not null as has_firm, portfolio, paying_arr_usd from dashboard.firm_penetration where snapshot_date = '2027-01-04' order by paying_arr_usd desc limit 3;
\echo '== 005: evidence first seen later in the week still counts (week of 2027-01-04 closes with members above)'
