-- ============================================================
-- Backfill: snap post-2026-10-31 responses to Monday of their ISO week
--
-- Context: between 2026-10-31 and the Clay HTTP columns being updated
-- to pass `run_day`, every weekly batch straddled UTC midnight and
-- landed as two chart points per week with the Nov-7/14/21 tail day
-- spiking. See supabase/weekly_granularity.sql for the full diagnosis.
--
-- This script snaps every row's `run_day` to the Monday of its ISO
-- week (matching what the weekly timeseries RPCs group by), then
-- rebuilds the last 30 days of cache so the dashboard reflects the
-- new dates.
--
-- Safe to run once or many times:
--   • WHERE clause excludes rows whose run_day is already a Monday,
--     so re-runs are no-ops.
--   • Pre-2026-10-31 data stayed on daily cadence; we don't touch it.
--   • The (prompt_id, platform, run_day) unique index is preserved
--     because each weekly batch runs each (prompt_id, platform) exactly
--     once — the day-1 and day-2 sets of a split batch are disjoint
--     (verified: Nov 6 vs Nov 7, Nov 13 vs Nov 14, Nov 20 vs Nov 21
--     all have zero (prompt_id, platform) overlap at full volume).
--
-- Run in a transaction so the cache refresh doesn't race against the
-- UPDATE. Should take a few seconds end-to-end.
-- ============================================================

BEGIN;

-- Snap `run_day` to the Monday of each ISO week.
UPDATE responses
SET run_day = date_trunc('week', run_day)::date
WHERE run_day >= '2026-10-31'
  AND run_day > date_trunc('week', run_day)::date;

-- Rebuild the cache for the affected window. refresh_dashboard_cache
-- deletes the last N days of all 6 cache tables and re-inserts from
-- the (now-snapped) responses. 30 days safely covers the whole
-- weekly regime so far.
SELECT refresh_dashboard_cache(30);

-- Narrative + materialized-view refreshes, if present. Wrapped in
-- a DO block so a missing function in a lighter-weight environment
-- doesn't block the transaction.
DO $$
BEGIN
  PERFORM refresh_narrative_cache(30);
EXCEPTION WHEN undefined_function THEN
  -- not installed in this env; skip silently
  NULL;
END $$;

DO $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_competitor_ranks;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

COMMIT;
