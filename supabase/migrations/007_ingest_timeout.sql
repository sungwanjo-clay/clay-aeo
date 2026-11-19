-- 007: give the API role room for concurrent weekly writes.
--
-- Clay's writes arrive through PostgREST as the `anon` role (the RPCs check their own keys). Supabase gives `anon` a
-- short statement timeout (a few seconds). With 20+ firm runs writing roster rows and workspace lookups at once, ordinary
-- 100-row ingests queue on each other and cross it ("57014 canceling statement due to statement timeout"), so runs lose
-- their writes. 30 seconds is still a hard stop for anything runaway.
--
-- Applies to every request made as anon in this project (the portfolio ingest/state/export RPCs; the tables themselves
-- are not exposed to anon).

alter role anon set statement_timeout = '30s';
notify pgrst, 'reload config';

-- dashboard.snapshot_companies looks up each company's first eligible week in company_snapshots by company_id; the
-- primary key leads with snapshot_date, so at ~10k companies that lookup was a scan per row and the view timed out.
create index if not exists company_snapshots_company_idx on portfolio.company_snapshots (company_id, snapshot_date);
analyze portfolio.company_snapshots;

-- The real cause of the roster-write timeouts: resolve_company matches rows on company_identifiers (id_type, value), but
-- the only index there is partial (id_type <> 'stealth_name'), which the planner can't use for a join against a row's
-- identifiers or for the stealth-name lookup, so every roster row did several full scans (~45k identifiers). Locally a
-- 100-row roster ingest went from ~800 ms to ~20 ms with this index; on shared Supabase the former crosses anon's 3 s limit.
create index if not exists company_identifiers_lookup_idx on portfolio.company_identifiers (id_type, value);
analyze portfolio.company_identifiers;
