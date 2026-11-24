-- ============================================================
-- Hotfix: remove the stale 6-arg timeseries RPC overloads.
--
-- The initial weekly_granularity.sql run added a 7-arg version
-- (with p_granularity) alongside the pre-existing 6-arg one.
-- PostgREST can't pick between them when a client passes 6 args
-- and raises PGRST203, breaking any chart that calls these RPCs
-- from a client that hasn't been redeployed with p_granularity.
--
-- Run this once in the Supabase SQL editor; it leaves only the
-- new 7-arg versions, whose p_granularity defaults to 'daily'
-- so older clients keep working unchanged.
--
-- (These same DROPs now live at the top of weekly_granularity.sql,
-- so re-running that file is an equivalent fix.)
-- ============================================================

DROP FUNCTION IF EXISTS get_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_competitor_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT);
DROP FUNCTION IF EXISTS get_sentiment_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_claygent_platform_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_followup_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
