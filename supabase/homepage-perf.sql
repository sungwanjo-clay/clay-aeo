-- ============================================================
-- Homepage / global-filter-bar performance audit (2026-07-05)
-- ============================================================
-- Finding: the homepage was already almost entirely RPC-backed (all KPI/chart
-- data comes from get_visibility_kpis, get_citation_share_kpi, etc.). The only
-- remaining client-side crawls affecting it were global-filter-bar queries that
-- run on EVERY page:
--   * getDistinctTags       -> get_distinct_tags_rpc        (see competitive-perf.sql #8)
--   * getDistinctPromptTypes -> get_distinct_prompt_types_rpc (below)
-- Also removed dead code getTopCompetitorThisWeek (crawled 4.4M-row
-- response_competitors + all responses; no callers).
-- ============================================================

-- Distinct prompt_type values for the Keyword Type dropdown. Replaces paginating
-- the prompts table (3-4 round trips) with one SELECT DISTINCT (~280ms).
CREATE OR REPLACE FUNCTION get_distinct_prompt_types_rpc()
RETURNS TABLE(prompt_type text) LANGUAGE sql STABLE SET statement_timeout='15000' AS $$
  SELECT DISTINCT lower(trim(prompt_type)) FROM prompts
  WHERE prompt_type IS NOT NULL AND trim(prompt_type) <> '' ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION get_distinct_prompt_types_rpc() TO anon, authenticated;

-- ============================================================
-- Homepage load after this: ~24 requests, no client-side table crawls.
-- Residual latency is the same concurrent-RPC contention noted for the
-- competitive tab (many RPCs fire at once on a small Supabase instance).
-- ============================================================
