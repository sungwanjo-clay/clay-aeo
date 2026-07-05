-- ============================================================
-- Clay AEO dashboard — heal cache gap + repair refresh cron
-- ============================================================
-- Context (Jul 5, 2026): the dashboard showed a 4-day hole
-- (Jun 28 – Jul 1) in ALL 8 cache tables even though raw
-- `responses` had full data for those days. Trend charts
-- rendered lines only from Jul 2 onward.
--
-- Root cause: the only refresh path that runs reliably is the
-- Vercel cron -> /api/refresh-cache -> refresh_dashboard_cache(3),
-- a 3-DAY window. A 3-day rebuild structurally cannot backfill a
-- gap once it is older than 3 days. The 14-day pg_cron safety net
-- ('refresh-dashboard-cache') was not healing it.
--
-- Run each STEP top-to-bottom in the Supabase SQL Editor.
-- ============================================================


-- ============================================================
-- STEP 1 — DIAGNOSE (read-only, safe)
-- ============================================================

-- 1a. Is the pg_cron refresh job scheduled and active?
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'refresh-dashboard-cache';
-- Expect one active row at '0 7 * * *'. If NO rows -> job was
-- never (re)scheduled or was unscheduled: STEP 3 fixes that.

-- 1b. Last 10 runs of that job — did it run Jun 28 – Jul 1? Errors?
SELECT start_time, end_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh-dashboard-cache')
ORDER BY start_time DESC
LIMIT 10;
-- Look for: missing dates (job didn't fire) OR status='failed'
-- (e.g. statement timeout, permission error).

-- 1c. Cache freshness vs raw data
SELECT 'cache' AS src, MAX(run_day) FROM aeo_cache_daily
UNION ALL
SELECT 'raw',   MAX(run_day) FROM responses;

-- 1d. Per-day gap (raw present, cache missing = the hole)
SELECT d.run_day,
       (SELECT COUNT(*) FROM responses r      WHERE r.run_day = d.run_day) AS raw_rows,
       (SELECT COUNT(*) FROM aeo_cache_daily c WHERE c.run_day = d.run_day) AS cache_rows
FROM (SELECT generate_series(CURRENT_DATE - 14, CURRENT_DATE, '1 day')::date AS run_day) d
ORDER BY d.run_day;


-- ============================================================
-- STEP 2 — HEAL the gap (rebuilds from intact raw `responses`)
-- ============================================================
-- Runs server-side with the function's own 120s timeout (the
-- REST API's 30s gateway cap does NOT apply here).
-- Rebuilds the last 14 days of all cache tables. No raw data touched.

SELECT refresh_dashboard_cache(14);

-- Verify the hole is filled (cache_rows should now be > 0 for every
-- day that has raw_rows):
SELECT d.run_day,
       (SELECT COUNT(*) FROM responses r      WHERE r.run_day = d.run_day) AS raw_rows,
       (SELECT COUNT(*) FROM aeo_cache_daily c WHERE c.run_day = d.run_day) AS cache_rows
FROM (SELECT generate_series(CURRENT_DATE - 14, CURRENT_DATE, '1 day')::date AS run_day) d
ORDER BY d.run_day;

-- If STEP 2 itself times out (>120s), the deployed function is too
-- slow — heal a smaller window first, e.g. refresh_dashboard_cache(8),
-- and treat "optimize the refresh function" as a follow-up.


-- ============================================================
-- STEP 3 — REPAIR the safety-net cron (self-healing, server-side)
-- ============================================================
-- pg_cron runs inside Postgres (120s function timeout, NOT the 30s
-- REST cap), so it can afford the wider 14-day self-healing window.
-- Idempotent: unschedules any existing job of this name, reschedules.

SELECT cron.unschedule('refresh-dashboard-cache')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-dashboard-cache');

SELECT cron.schedule(
  'refresh-dashboard-cache',
  '0 7 * * *',                        -- 07:00 UTC daily (midnight PST)
  $$ SELECT refresh_dashboard_cache(14); $$
);

-- Confirm it's scheduled and active:
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'refresh-dashboard-cache';
