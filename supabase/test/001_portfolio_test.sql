-- Local test for 001_portfolio.sql. Run against a throwaway Postgres 15+ after the migration
-- (the runner script creates the anon/authenticated roles first, as Supabase has them).
\set ON_ERROR_STOP on
\pset footer off
insert into portfolio.ingest_keys (key_name, key_hash, kinds)
values ('clay-test', extensions.crypt('test-key', extensions.gen_salt('bf')), '{firms,roster,snapshots,runs}'),
       ('roster-only', extensions.crypt('roster-key', extensions.gen_salt('bf')), '{roster}'),
       ('sync-read', extensions.crypt('read-key', extensions.gen_salt('bf')), '{read}');

\echo '== 1. firms: two sheet tabs loaded separately keep separate flags'
set role anon;
select public.portfolio_ingest('test-key', 'firms', '[
  {"firm":"Y Combinator","firm_type":"accelerator","partner_checkbox":false,"stage_focus":"Pre-seed","region":"Global (US HQ)",
   "referral_url":"https://cohorts.clay.com/wedge#apply?utm_medium=community&utm_campaign=wedge-y-combinator-referral"},
  {"firm":"Basis Set Ventures","partner_checkbox":true,"outreached":true,"stage_focus":"Seed"},
  {"firm":"Accel","partner_checkbox":false,"stage_focus":"Seed through growth/IPO (multi-stage - flagged)"}]');
select public.portfolio_ingest('test-key', 'firms', '[{"firm":"Accel","on_to_approve_tab":true},{"firm":"Bitkraft","on_proven_tab":true}]');
reset role;
select name, firm_type, partner_checkbox, on_proven_tab, on_to_approve_tab, is_multi_stage, referral_utm_campaign from portfolio.firms order by name;

\echo '== 2. roster: first load'
set role anon;
select public.portfolio_ingest('test-key', 'roster', '[
  {"firm":"Y Combinator","source":"yc_directory","source_ref":"lumen","company_name":"Lumen","domain":"https://www.LumenHQ.com/","yc_slug":"lumen","relationship":"cohort","round_or_batch":"W25","invested_at":"2025-01-06","evidence_url":"https://www.ycombinator.com/companies/lumen","observed_at":"2026-11-10T00:00:00Z","verification_status":"verified"},
  {"firm":"Y Combinator","source":"harmonic","source_ref":"hm_1","company_name":"Lumen","harmonic_id":"HM_1","domain":"lumenhq.com","observed_at":"2026-11-10T00:00:00Z"},
  {"firm":"Basis Set Ventures","source":"partner_list","source_ref":"basis-2026-10","company_name":"Fernway","domain":"fernway.co","relationship":"investor","round_or_batch":"seed","verification_status":"verified"},
  {"firm":"Basis Set Ventures","source":"workspace_match","source_ref":"ws_88","company_name":"Tally","domain":"tallyhq.com","verification_status":"verified"},
  {"firm":"Accel","source":"announcement","source_ref":"https://techcrunch.com/x","company_name":"Stealth Co","relationship":"investor","round_or_batch":"seed","verification_status":"review"},
  {"firm":"Unknown Fund","source":"harmonic","source_ref":"x","company_name":"Nope","domain":"nope.io"},
  {"firm":"Accel","source":"made_up_source","source_ref":"x","company_name":"Nope","domain":"nope.io"}]') as first_load;

\echo '== 3. same batch again (retry): nothing new, first_observed_at unchanged'
select public.portfolio_ingest('test-key', 'roster', '[
  {"firm":"Y Combinator","source":"yc_directory","source_ref":"lumen","company_name":"Lumen","domain":"lumenhq.com","yc_slug":"lumen","observed_at":"2026-11-17T00:00:00Z"},
  {"firm":"Y Combinator","source":"harmonic","source_ref":"hm_1","company_name":"Lumen","harmonic_id":"hm_1","observed_at":"2026-11-17T00:00:00Z"},
  {"firm":"Basis Set Ventures","source":"partner_list","source_ref":"basis-2026-10","company_name":"Fernway","domain":"fernway.co"},
  {"firm":"Basis Set Ventures","source":"workspace_match","source_ref":"ws_88","company_name":"Tally","domain":"tallyhq.com"},
  {"firm":"Accel","source":"announcement","source_ref":"https://techcrunch.com/x","company_name":"Stealth Co"}]') as retry;

\echo '== 4. stealth company gains a domain: same company_id, no longer stealth'
select public.portfolio_ingest('test-key', 'roster', '[
  {"firm":"Accel","source":"crunchbase","source_ref":"stealth-co","company_name":"Stealth Co","crunchbase_slug":"stealth-co"}]') as attach_crunchbase;
reset role;
-- simulate the workflow learning the domain on the crunchbase record
set role anon;
select public.portfolio_ingest('test-key', 'roster', '[
  {"firm":"Accel","source":"crunchbase","source_ref":"stealth-co","company_name":"Stealth Co","crunchbase_slug":"stealth-co","domain":"stealthco.ai"}]') as gains_domain;

\echo '== 4b. another firm''s "Stealth Co" stays a separate company'
select public.portfolio_ingest('test-key', 'roster', '[
  {"firm":"Y Combinator","source":"announcement","source_ref":"https://example.com/other","company_name":"Stealth Co","verification_status":"review"}]') as other_stealth;

\echo '== 5. ambiguous: a row whose ids point at two different companies goes to review'
select public.portfolio_ingest('test-key', 'roster', '[
  {"firm":"Y Combinator","source":"harmonic","source_ref":"hm_x","company_name":"Mixed","harmonic_id":"hm_1","domain":"fernway.co"}]') as ambiguous;

\echo '== 6. snapshots, two weeks; rerun of week 2 replaces only week 2'
select public.portfolio_ingest('test-key', 'snapshots', '[
  {"snapshot_date":"2026-11-09","domain":"lumenhq.com","funding_stage":"seed","funding_fit":"fits","clay_account":"none","net_new_check":"needs_check"},
  {"snapshot_date":"2026-11-16","domain":"lumenhq.com","funding_stage":"seed","funding_fit":"fits","clay_account":"none","net_new_check":"pass","data_gaps":["no_headcount"]},
  {"snapshot_date":"2026-11-16","domain":"fernway.co","funding_stage":"seed","funding_fit":"fits","clay_account":"free","net_new_check":"fail","net_new_reason":"existing_free_workspace"},
  {"snapshot_date":"2026-11-16","domain":"unknown.example","funding_fit":"unknown","net_new_check":"needs_check"}]') as snapshots;
select public.portfolio_ingest('test-key', 'snapshots', '[
  {"snapshot_date":"2026-11-16","domain":"lumenhq.com","funding_stage":"seed","funding_fit":"fits","clay_account":"none","net_new_check":"pass","headcount":12}]') as rerun_week2;
select public.portfolio_ingest('test-key', 'runs', '[{"run_id":"00000000-0000-0000-0000-000000000001","workflow":"roster","firm":"Y Combinator","status":"succeeded","finished_at":"2026-11-17T01:00:00Z"}]') as runs;

\echo '== 7. key checks'
\set ON_ERROR_STOP off
select public.portfolio_ingest('wrong-key', 'roster', '[]');
select public.portfolio_ingest('roster-key', 'snapshots', '[]');
\echo '== 8. anon cannot touch tables, views or helper functions'
select count(*) from portfolio.firms;
select count(*) from dashboard.roster;
select portfolio.ingest_roster('[]');
reset role;
set role authenticated;
select public.portfolio_ingest('test-key', 'roster', '[]');
select count(*) from dashboard.firms;
reset role;
\echo '== 9. dashboard_sync reads views only'
set role dashboard_sync;
select count(*) as firms_visible from dashboard.firms;
select count(*) from portfolio.companies;
select count(*) from portfolio.relationship_evidence;
select public.portfolio_ingest('test-key', 'roster', '[]');
reset role;
\set ON_ERROR_STOP on

\echo '== 9b. export: read key reads views; write keys and other views refused'
\set ON_ERROR_STOP off
set role anon;
select public.portfolio_export('test-key', 'roster');
select public.portfolio_export('read-key', 'pg_authid');
select public.portfolio_ingest('read-key', 'roster', '[]');
select jsonb_array_length(public.portfolio_export('read-key', 'roster')->'rows') as roster_rows,
       public.portfolio_export('read-key', 'roster', 0, 2)->'done' as done_page1,
       jsonb_array_length(public.portfolio_export('read-key', 'roster', 2, 2)->'rows') as page2_rows;
reset role;
\set ON_ERROR_STOP on

\echo '== 10. what the dashboard sees'
set role dashboard_sync;
select f.name as firm, c.name as company, c.domain, c.all_domains, c.is_stealth, r.sources, r.qualifying_sources, r.in_denominator, r.shared_by_partner, r.verification_status
from dashboard.roster r join dashboard.companies c using (company_id) join dashboard.firms f using (firm_id) order by 1, 2;
select company_id is not null as ok, snapshot_date, funding_fit, net_new_check, headcount, first_funding_fit_at, first_eligible_at
from dashboard.company_status order by snapshot_date;
select f.name, s.source, s.companies, s.only_this_source from dashboard.source_coverage s join dashboard.firms f using (firm_id) order by 1, 2;
select * from dashboard.review_queue order by 1, 2;
select name, roster_refreshed_at from dashboard.firms where roster_refreshed_at is not null;
reset role;
select source, first_observed_at, last_observed_at from portfolio.relationship_evidence where source in ('yc_directory','harmonic') order by 1;
select count(*) as snapshot_rows from portfolio.company_snapshots;
