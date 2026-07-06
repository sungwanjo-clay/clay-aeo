-- ============================================================
-- Citations + Sentiment tab audit (2026-07-05)
-- ============================================================
-- Both tabs were already RPC-backed on load (no client-side crawls):
--   Citations: get_citation_share_kpi, get_citation_count_kpi,
--     get_top_cited_domains_rpc, get_competitor_citation_timeseries_rpc,
--     + cache-table reads (aeo_cache_daily/domains/topics).
--   Sentiment: get_sentiment_breakdown_rpc, get_sentiment_timeseries_rpc,
--     get_sentiment_narratives_rpc, get_competitive_positioning_rpc.
--
-- One real bug found: getCitationTypeBreakdown read aeo_cache_domains with a
-- hard .limit(2000), but that table has ~18k rows for a 7-day window — so it
-- silently dropped ~90% of the data (raw counts ~8x too low). Fixed with an RPC.
-- Also removed dead getCitationShareTimeseries (fetchAllPages crawl of responses,
-- no callers). getCitationCoverage was fine (uses count:exact,head:true — a
-- server-side COUNT, no row transfer).
-- ============================================================

-- Citation-type breakdown: server-side SUM(response_count) GROUP BY citation_type.
CREATE OR REPLACE FUNCTION get_citation_type_breakdown_rpc(
  p_start_day date, p_end_day date, p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL
) RETURNS TABLE(type text, count bigint)
LANGUAGE sql STABLE SET statement_timeout='15000' AS $$
  SELECT COALESCE(citation_type,'Other') AS type, SUM(response_count)::bigint AS count
  FROM aeo_cache_domains
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND (p_platforms IS NULL OR platform = ANY(p_platforms))
    AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type)
  GROUP BY COALESCE(citation_type,'Other') ORDER BY 2 DESC;
$$;
GRANT EXECUTE ON FUNCTION get_citation_type_breakdown_rpc(date,date,text,text[]) TO anon, authenticated;

-- Sentiment tab: no changes needed — already fully RPC-backed.
