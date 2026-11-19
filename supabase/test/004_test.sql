-- Test for 004_incremental_state.sql. Runs after 003_test.sql on the same database.
\set ON_ERROR_STOP on
\pset footer off
update portfolio.ingest_keys set kinds = kinds || '{firm_identity,firm_sources,verifications,source_runs}' where key_name = 'clay-test';
insert into portfolio.ingest_keys (key_name, key_hash, kinds) values ('clay-state', extensions.crypt('state-key', extensions.gen_salt('bf')), '{state}');
select key_name, kinds @> '{firm_identity,verifications}' as has_new_kinds from portfolio.ingest_keys where key_name = 'clay-workflows';

\echo '== 1. identity cache, sources with forward-only checkpoints, verifications, source runs'
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-key":"test-key"}', true);
select public.portfolio_ingest_h('firm_identity', '[{"firm":"Y Combinator","official_name":"Y Combinator","firm_domain":"ycombinator.com","firm_type":"Accelerator","aliases":["YC","Y Combinator"],"alias_collisions":["YC Group"],"linkedin_url":"https://www.linkedin.com/company/y-combinator","identity_confidence":"High"}]') as identity;
select public.portfolio_ingest_h('firm_sources', '[{"firm":"Y Combinator","url":"https://www.ycombinator.com/blog","source_type":"blog","status":"verified","last_success_at":"2026-11-19T00:00:00Z","checkpoint_date":"2026-11-15","checkpoint_url":"https://www.ycombinator.com/blog/new"}]') as source1;
select public.portfolio_ingest_h('firm_sources', '[{"firm":"Y Combinator","url":"https://www.ycombinator.com/blog","source_type":"blog","last_failure_at":"2026-11-26T00:00:00Z","checkpoint_date":"2026-10-01","checkpoint_url":"https://old"}]') as failed_read_does_not_rewind;
select public.portfolio_ingest_h('verifications', '[
  {"firm":"Y Combinator","domain":"lumenhq.com","company_name":"Lumen","backing":"Confirmed","relationship":"Accelerator cohort","backing_source_url":"https://www.ycombinator.com/companies/lumen","latest_round_type":"Seed","latest_round_date":"2026-03-02","latest_round_amount_usd":3000000,"firm_in_latest_round":"Yes","signal_key":"seed|2026-03-02"},
  {"firm":"Y Combinator","domain":"brandnew.ai","company_name":"Brand New","backing":"Confirmed","relationship":"Investor","signal_key":"a"},
  {"firm":"Y Combinator","domain":"nope.ai","company_name":"Nope","backing":"Different firm","signal_key":"x"},
  {"firm":"Y Combinator","domain":"skip.ai","company_name":"Skip","backing":"Not checked (verification failed)"}]') as verifications;
select public.portfolio_ingest_h('source_runs', '[{"run_id":"00000000-0000-0000-0000-0000000000aa","firm":"Y Combinator","source":"dealroom","status":"capped","companies":3000,"new_companies":12,"cap_hit":true},
  {"run_id":"00000000-0000-0000-0000-0000000000aa","firm":"Y Combinator","source":"official_portfolio","status":"partial","companies":400}]') as source_runs;
commit;
select url, status, checkpoint_date, checkpoint_url, last_success_at is not null as had_success, last_failure_at is not null as had_failure from portfolio.firm_sources;
select c.name, cf.verification_status from portfolio.company_firms cf join portfolio.companies c using (company_id) join portfolio.firms f using (firm_id) where f.name = 'Y Combinator' order by 1;

\echo '== 2. state read: header key with the state kind only'
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-read-key":"state-key"}', true);
select s->'firm_known' as known, s->'identity'->>'firm_domain' as domain, s->'identity'->'aliases' as aliases, s->>'known_count' as known_count,
       jsonb_array_length(s->'sources') as sources, s->>'directory_read_at' is not null as directory_read
from (select public.portfolio_state_h('Y Combinator') s) x;
select k->>'name' as company, k->>'verification_status' as status, k->>'backing' as backing, k->>'latest_round_date' as round_date, k->>'signal_key' as signal
from (select jsonb_array_elements(public.portfolio_state_h('Y Combinator')->'known_companies') k) x order by 1;
commit;
\set ON_ERROR_STOP off
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-read-key":"read-key"}', true);
select public.portfolio_state_h('Y Combinator') as dashboard_read_key_refused; rollback;
begin; set local role anon; select set_config('request.headers', '{"x-portfolio-read-key":"state-key","x-portfolio-key":"state-key"}', true);
select public.portfolio_ingest_h('verifications', '[]') as state_key_cannot_write; rollback;
begin; set local role anon; select set_config('request.headers', '{}', true);
select public.portfolio_state_h('Y Combinator') as no_header; rollback;
\set ON_ERROR_STOP on
\echo '== 3. review queue for the new kinds'
select kind, reason, open_rows from dashboard.review_queue where kind in ('verification', 'firm_identity', 'firm_sources', 'source_run') order by 1, 2;
