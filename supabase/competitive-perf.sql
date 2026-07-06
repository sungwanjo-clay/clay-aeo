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
-- 3. Per-competitor KPIs — cache-based (replaces getFilteredResponses x2
--    + batched response_competitors lookups). visibility/mention/top_platform
--    are byte-identical to the old client path in the default view (verified
--    vs ZoomInfo/HubSpot/Apollo). topTopic dropped (needed a 4.4M-row
--    responses join and was uselessly constant). ~300ms.
CREATE OR REPLACE FUNCTION get_competitor_kpis_rpc(
  p_competitor text, p_start_day date, p_end_day date,
  p_prev_start_day date, p_prev_end_day date,
  p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL
) RETURNS TABLE(
  visibility_current double precision, visibility_previous double precision,
  mention_count bigint, top_platform text
) LANGUAGE sql STABLE SET statement_timeout = '30000' AS $$
  WITH cc AS (
    SELECT run_day, platform, mention_count FROM aeo_cache_competitors
    WHERE competitor_name = p_competitor AND run_day BETWEEN p_prev_start_day AND p_end_day
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
  ),
  cd AS (
    SELECT run_day, platform, total_responses FROM aeo_cache_daily
    WHERE run_day BETWEEN p_prev_start_day AND p_end_day
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
  ),
  agg AS (
    SELECT
      (SELECT COALESCE(SUM(mention_count),0)   FROM cc WHERE run_day BETWEEN p_start_day AND p_end_day)           AS num_cur,
      (SELECT COALESCE(SUM(mention_count),0)   FROM cc WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS num_prev,
      (SELECT COALESCE(SUM(total_responses),0) FROM cd WHERE run_day BETWEEN p_start_day AND p_end_day)           AS den_cur,
      (SELECT COALESCE(SUM(total_responses),0) FROM cd WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS den_prev
  )
  SELECT
    CASE WHEN a.den_cur  > 0 THEN (a.num_cur::double precision  / a.den_cur)  * 100 END,
    CASE WHEN a.den_prev > 0 THEN (a.num_prev::double precision / a.den_prev) * 100 END,
    a.num_cur::bigint,
    (SELECT platform FROM (SELECT platform, SUM(mention_count) n FROM cc WHERE run_day BETWEEN p_start_day AND p_end_day AND platform IS NOT NULL GROUP BY platform ORDER BY n DESC LIMIT 1) t)
  FROM agg a;
$$;
GRANT EXECUTE ON FUNCTION get_competitor_kpis_rpc(text,date,date,date,date,text,text[]) TO anon, authenticated;

-- 4. Platform heatmap — cache-based, scoped to top-N competitors (UI shows top 50).
--    Also fixes a latent client bug: the old unfiltered response_competitors
--    batches hit PostgREST's 1000-row cap and silently undercounted.
CREATE OR REPLACE FUNCTION get_platform_heatmap_rpc(
  p_start_day date, p_end_day date,
  p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL, p_limit int DEFAULT 100
) RETURNS TABLE(competitor text, platform text, visibility_score double precision)
LANGUAGE sql STABLE SET statement_timeout = '30000' AS $$
  WITH num AS (
    SELECT competitor_name, platform, SUM(mention_count) AS cnt FROM aeo_cache_competitors
    WHERE run_day BETWEEN p_start_day AND p_end_day AND competitor_name IS NOT NULL
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY competitor_name, platform
  ),
  den AS (
    SELECT platform, SUM(total_responses) AS total FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY platform
  ),
  ranked AS (SELECT competitor_name FROM num GROUP BY competitor_name ORDER BY SUM(cnt) DESC LIMIT p_limit)
  SELECT n.competitor_name, n.platform,
         CASE WHEN d.total > 0 THEN (n.cnt::double precision / d.total) * 100 ELSE 0 END
  FROM num n JOIN den d ON d.platform = n.platform
  WHERE n.competitor_name IN (SELECT competitor_name FROM ranked);
$$;
GRANT EXECUTE ON FUNCTION get_platform_heatmap_rpc(date,date,text,text[],int) TO anon, authenticated;

-- ============================================================
-- STILL TODO: getCompetitorPMMComparisonBatch, getCompetitorCitationsFlat,
-- and the competitor sentiment query still crawl `responses` client-side.
-- Convert to RPCs next.
-- ============================================================
