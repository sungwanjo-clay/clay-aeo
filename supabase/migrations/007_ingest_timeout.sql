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
