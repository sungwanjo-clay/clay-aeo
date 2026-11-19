-- Test for 008 (churned ARR). Runs after 006_test.sql on the same database: reopens the week of 2027-01-04 and rewrites
-- its two test companies, one paying now and one churned.
\set ON_ERROR_STOP on
\pset footer off
\echo '== 008: a churned company carries its ARR at churn; a paying one carries 0'
select distinct on (c.company_id) c.company_id, ci.value as domain into temp t8 from portfolio.company_firms cf join portfolio.companies c using (company_id)
  join portfolio.company_identifiers ci on ci.company_id = c.company_id and ci.id_type = 'domain'
  join portfolio.relationship_evidence e using (relationship_id) join portfolio.sources s on s.source = e.source and s.counts_toward_denominator
  where cf.verification_status = 'verified' limit 2;
select jsonb_agg(jsonb_build_object('snapshot_date','2027-01-04','domain',domain,'lookup_status','matched',
  'paying_arr_usd', case when rn = 1 then 12000 else 0 end, 'churned_arr_usd', case when rn = 1 then 500 else 4800 end,
  'churned_at', case when rn = 2 then '2026-12-01' end,
  'workspaces', jsonb_build_array(jsonb_build_object('workspace_id','w'||rn,'match_method','creator_domain','paying_now',rn = 1,'ever_paid',true))))::text as rows
  from (select domain, row_number() over () as rn from t8) z \gset
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"test-key"}', true);
select public.portfolio_ingest_h('snapshot_open', '[{"snapshot_date":"2027-01-04","reopen":true}]') as opened;
select public.portfolio_ingest_h('workspace_lookups', :'rows'::jsonb) as lookups;
select public.portfolio_ingest_h('snapshot_close', '[{"snapshot_date":"2027-01-04"}]') as closed;
commit;
select paying_now, ever_paid, paying_arr_usd, churned_arr_usd, churned_at from dashboard.snapshot_companies
  where snapshot_date = '2027-01-04' and company_id in (select company_id from t8) order by paying_now desc;
select cut, paying_now, paying_arr_usd, churned, churned_arr_usd, churned_90d from dashboard.portfolio_totals where snapshot_date = '2027-01-04' and cut = 'all';
