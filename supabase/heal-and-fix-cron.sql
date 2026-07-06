-- ============================================================
-- Clay AEO dashboard — heal cache gap + fix refresh cron timeout
-- ============================================================
-- Incident 2026-07-05: the dashboard showed a multi-day hole
-- (Jun 28 – Jul 1) in ALL cache tables even though raw `responses`
-- had full data. Trend charts rendered lines only from Jul 2.
--
-- ROOT CAUSE (confirmed via cron.job_run_details): the pg_cron job
-- 'refresh-dashboard-cache' (jobid 13) FAILED 6 days straight
-- (Jun 29 – Jul 4), each canceled at exactly 120s with
-- "canceling statement due to statement timeout". Failed runs roll
-- back atomically, so the cache never advanced -> the gap.
--
-- The 120s ceiling is the `postgres` ROLE DEFAULT statement_timeout
-- (2min). The refresh functions normally run ~44s (dashboard) + ~10s
-- (narrative), but exceed 120s on heavy Clay-concurrent-push days.
--
-- Live cron command (NOT what setup-cron.sql in this repo says):
--   SELECT refresh_dashboard_cache(3); SELECT refresh_narrative_cache(3);
--
-- Run each STEP in the Supabase SQL Editor (or a direct psql/pg
-- connection, which also works when api.supabase.com is down).
-- ============================================================


-- ============================================================
-- STEP 1 — DIAGNOSE (read-only)
-- ============================================================

-- 1a. The refresh job + its exact command
SELECT jobid, jobname, schedule, active, command
FROM cron.job WHERE jobname = 'refresh-dashboard-cache';

-- 1b. Recent runs — look for status='failed' / 'statement timeout'
SELECT start_time, end_time, status, left(return_message, 100) AS return_message
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'refresh-dashboard-cache')
ORDER BY start_time DESC LIMIT 10;

-- 1c. Per-day gap (raw present, cache missing = the hole)
SELECT d.run_day,
       (SELECT COUNT(*) FROM responses r      WHERE r.run_day = d.run_day) AS raw_rows,
       (SELECT COUNT(*) FROM aeo_cache_daily c WHERE c.run_day = d.run_day) AS cache_rows
FROM (SELECT generate_series(CURRENT_DATE - 14, CURRENT_DATE, '1 day')::date AS run_day) d
ORDER BY d.run_day;


-- ============================================================
-- STEP 2 — FIX the timeout (prevents recurrence)
-- ============================================================
-- Give the refresh functions their own statement_timeout that
-- OVERRIDES the 120s role default while they run. Function-local
-- SET wins over the session/role default for the function body.
-- (~3x headroom over the ~44s + ~10s typical runtime.)

ALTER FUNCTION public.refresh_dashboard_cache(integer) SET statement_timeout = '300000';
ALTER FUNCTION public.refresh_dashboard_cache()        SET statement_timeout = '300000';
ALTER FUNCTION public.refresh_narrative_cache(integer) SET statement_timeout = '300000';

-- Verify (proconfig should list statement_timeout=300000 for each):
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('refresh_dashboard_cache','refresh_narrative_cache')
ORDER BY p.proname;


-- ============================================================
-- STEP 3 — HEAL the existing gap (rebuild from intact raw data)
-- ============================================================
-- Wider one-off window than the daily 3-day cron. Now safe from the
-- 120s cap thanks to STEP 2. Direct connection can also SET statement_timeout
-- = '300000' for the session before running.

SELECT refresh_dashboard_cache(14);
SELECT refresh_narrative_cache(14);

-- Verify the hole is filled (cache_rows > 0 for every day with raw_rows):
SELECT d.run_day,
       (SELECT COUNT(*) FROM responses r      WHERE r.run_day = d.run_day) AS raw_rows,
       (SELECT COUNT(*) FROM aeo_cache_daily c WHERE c.run_day = d.run_day) AS cache_rows
FROM (SELECT generate_series(CURRENT_DATE - 14, CURRENT_DATE, '1 day')::date AS run_day) d
ORDER BY d.run_day;


-- ============================================================
-- FOLLOW-UPS (not done here)
-- ============================================================
-- * Optimize the refresh function — 300s is a stopgap; a 3-day
--   incremental rebuild should take seconds, not ~44s.
-- * The Vercel cron (GET /api/refresh-cache @ 23:45 UTC) uses the
--   service-role REST path, capped at 30s — it can never finish the
--   rebuild and is a redundant no-op. Consider removing it.
-- * Update setup-cron.sql to match the live command (p_days=3 +
--   refresh_narrative_cache), or reconcile the two.
