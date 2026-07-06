-- ============================================================
-- Competitive tab performance fixes (2026-07-05)
-- ============================================================
-- Applied directly to production; recorded here so the schema is
-- reproducible. Pairs with frontend changes in:
--   lib/queries/competitive.ts   (getCompetitorList → RPC)
--   app/competitive/page.tsx     (default selectedComps=['Clay'])
--   components/competitive/CompPMMComparison.tsx (lazy response_text)
--
-- Problem measured: opening the Competitive tab fired 227 paginated
-- requests to aeo_cache_competitors (~321k rows, ~40s) just to build
-- the competitor dropdown — and it gated the whole tab. Expanding a
-- topic paginated `responses` INCLUDING full response_text (~20s).
-- ============================================================

-- 1. Server-side competitor list (ranked distinct names by mentions).
--    Replaces the 321k-row client-side crawl with one GROUP BY.
CREATE OR REPLACE FUNCTION get_competitor_list_rpc(p_limit int DEFAULT 200)
RETURNS TABLE(competitor_name text, total_mentions bigint)
LANGUAGE sql STABLE
SET statement_timeout = '30000'
AS $$
  SELECT competitor_name, SUM(mention_count)::bigint AS total_mentions
  FROM aeo_cache_competitors
  WHERE competitor_name IS NOT NULL
  GROUP BY competitor_name
  ORDER BY total_mentions DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION get_competitor_list_rpc(int) TO anon, authenticated;

-- 2. Covering index so the GROUP BY does an index-only scan.
--    Took the RPC from 3-14s (full scan, contended) to ~250ms.
CREATE INDEX IF NOT EXISTS idx_aeo_cache_competitors_name_mentions
  ON aeo_cache_competitors (competitor_name) INCLUDE (mention_count)
  WHERE competitor_name IS NOT NULL;

-- ============================================================
-- FOLLOW-UP (not done): the tab still fires several concurrent
-- client-side `responses` crawls — getFilteredResponses (x2, cur+prev),
-- getCompetitorPMMComparisonBatch, getCompetitorCitationsFlat, and the
-- sentiment query — ~67 paginated requests total. These should each
-- become server-side aggregation RPCs (like get_visibility_kpis etc.).
-- ============================================================
