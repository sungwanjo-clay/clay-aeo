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

-- 5. Winners & Losers — cache-based (replaces paginating aeo_cache_competitors
--    x2, cur+prev). Top-250 by current share. current/previous verified identical
--    to the old path (ZoomInfo 48.299/48.835, HubSpot 47.939/46.977).
CREATE OR REPLACE FUNCTION get_winners_losers_rpc(
  p_start_day date, p_end_day date, p_prev_start_day date, p_prev_end_day date,
  p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL, p_limit int DEFAULT 250
) RETURNS TABLE(competitor_name text, current double precision, previous double precision, delta double precision, is_new boolean)
LANGUAGE sql STABLE SET statement_timeout='30000' AS $$
  WITH cur AS (SELECT competitor_name, SUM(mention_count) m FROM aeo_cache_competitors
    WHERE run_day BETWEEN p_start_day AND p_end_day AND competitor_name IS NOT NULL
      AND (p_platforms IS NULL OR platform = ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type) GROUP BY competitor_name),
  prv AS (SELECT competitor_name, SUM(mention_count) m FROM aeo_cache_competitors
    WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day AND competitor_name IS NOT NULL
      AND (p_platforms IS NULL OR platform = ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type) GROUP BY competitor_name),
  tot AS (SELECT (SELECT COALESCE(SUM(total_responses),0) FROM aeo_cache_daily WHERE run_day BETWEEN p_start_day AND p_end_day AND (p_platforms IS NULL OR platform=ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type)) ct,
                 (SELECT COALESCE(SUM(total_responses),0) FROM aeo_cache_daily WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day AND (p_platforms IS NULL OR platform=ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type)) pt)
  SELECT COALESCE(c.competitor_name, p.competitor_name),
         CASE WHEN t.ct>0 THEN COALESCE(c.m,0)::double precision/t.ct*100 ELSE 0 END,
         CASE WHEN t.pt>0 THEN COALESCE(p.m,0)::double precision/t.pt*100 ELSE NULL END,
         CASE WHEN t.pt>0 THEN (COALESCE(c.m,0)::double precision/NULLIF(t.ct,0)*100) - (COALESCE(p.m,0)::double precision/t.pt*100) ELSE NULL END,
         ((t.pt=0 OR COALESCE(p.m,0)=0) AND COALESCE(c.m,0)>0)
  FROM cur c FULL OUTER JOIN prv p ON p.competitor_name=c.competitor_name CROSS JOIN tot t
  ORDER BY 2 DESC LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION get_winners_losers_rpc(date,date,date,date,text,text[],int) TO anon, authenticated;

-- 6. Per-competitor daily timeseries — cache-based (replaces client pagination).
CREATE OR REPLACE FUNCTION get_competitor_timeseries_rpc(
  p_competitor text, p_start_day date, p_end_day date, p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL
) RETURNS TABLE(date text, clay double precision, competitor double precision)
LANGUAGE sql STABLE SET statement_timeout='30000' AS $$
  WITH d AS (SELECT run_day, SUM(total_responses) total, SUM(clay_mentioned) clay FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day AND (p_platforms IS NULL OR platform=ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type) GROUP BY run_day),
  cc AS (SELECT run_day, SUM(mention_count) m FROM aeo_cache_competitors
    WHERE competitor_name=p_competitor AND run_day BETWEEN p_start_day AND p_end_day AND (p_platforms IS NULL OR platform=ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type) GROUP BY run_day)
  SELECT COALESCE(d.run_day, cc.run_day)::text,
         CASE WHEN d.total>0 THEN d.clay::double precision/d.total*100 ELSE 0 END,
         CASE WHEN d.total>0 THEN COALESCE(cc.m,0)::double precision/d.total*100 ELSE 0 END
  FROM d FULL OUTER JOIN cc ON cc.run_day=d.run_day ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION get_competitor_timeseries_rpc(text,date,date,text,text[]) TO anon, authenticated;

-- 7. PMM comparison per competitor. Clay → aeo_cache_pmm (~150ms). Others →
--    server-side responses scan with the same normalized-substring match on
--    competitors_mentioned (jsonb). Verified identical to old client logic.
CREATE OR REPLACE FUNCTION get_pmm_comparison_rpc(
  p_competitor text, p_start_day date, p_end_day date,
  p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL
) RETURNS TABLE(pmm_use_case text, total_responses bigint, clay_visibility double precision, competitor_visibility double precision, delta double precision)
LANGUAGE plpgsql STABLE SET statement_timeout='30000' AS $fn$
DECLARE slug text := regexp_replace(lower(p_competitor), '[^a-z0-9]', '', 'g');
BEGIN
  IF p_competitor = 'Clay' THEN
    RETURN QUERY
      SELECT p.pmm_use_case, SUM(p.total_responses)::bigint,
             CASE WHEN SUM(p.total_responses)>0 THEN SUM(p.clay_mentioned)::double precision/SUM(p.total_responses)*100 ELSE 0 END,
             CASE WHEN SUM(p.total_responses)>0 THEN SUM(p.clay_mentioned)::double precision/SUM(p.total_responses)*100 ELSE 0 END, 0::double precision
      FROM aeo_cache_pmm p WHERE p.run_day BETWEEN p_start_day AND p_end_day AND p.pmm_use_case IS NOT NULL
        AND (p_platforms IS NULL OR p.platform = ANY(p_platforms)) AND (p_prompt_type='all' OR p.prompt_type ILIKE p_prompt_type)
      GROUP BY p.pmm_use_case ORDER BY 4 DESC;
  ELSE
    RETURN QUERY
      SELECT r.pmm_use_case, COUNT(*)::bigint,
             CASE WHEN COUNT(*)>0 THEN COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')::double precision/COUNT(*)*100 ELSE 0 END,
             CASE WHEN COUNT(*)>0 THEN COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.competitors_mentioned) e WHERE regexp_replace(lower(e),'[^a-z0-9]','','g') LIKE '%'||slug||'%'))::double precision/COUNT(*)*100 ELSE 0 END,
             CASE WHEN COUNT(*)>0 THEN (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.competitors_mentioned) e WHERE regexp_replace(lower(e),'[^a-z0-9]','','g') LIKE '%'||slug||'%')) - COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes'))::double precision/COUNT(*)*100 ELSE 0 END
      FROM responses r WHERE r.run_day BETWEEN p_start_day AND p_end_day AND r.pmm_use_case IS NOT NULL
        AND (p_platforms IS NULL OR r.platform = ANY(p_platforms)) AND (p_prompt_type='all' OR r.prompt_type ILIKE p_prompt_type)
      GROUP BY r.pmm_use_case ORDER BY 4 DESC;
  END IF;
END $fn$;
GRANT EXECUTE ON FUNCTION get_pmm_comparison_rpc(text,date,date,text,text[]) TO anon, authenticated;

-- 8. Distinct tags for the global filter bar — replaces a 30+ page crawl of
--    responses that ran on EVERY page load.
CREATE OR REPLACE FUNCTION get_distinct_tags_rpc(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(tag text) LANGUAGE sql STABLE SET statement_timeout='20000' AS $$
  SELECT DISTINCT trim(tags) FROM responses
  WHERE tags IS NOT NULL AND trim(tags) <> '' AND run_date >= p_start AND run_date <= p_end ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION get_distinct_tags_rpc(timestamptz,timestamptz) TO anon, authenticated;

-- 9. Covering index so the range-filtered aggregations (winners/heatmap/timeseries)
--    do index-only scans — needed because ~8 of them fire concurrently on load.
CREATE INDEX IF NOT EXISTS idx_aeo_cache_comp_rangeagg
  ON aeo_cache_competitors (run_day, prompt_type, platform) INCLUDE (competitor_name, mention_count);

-- 10. Multi-competitor timeseries — ONE scan of aeo_cache_competitors for all
--     chart competitors, instead of N concurrent get_competitor_timeseries_rpc
--     calls. Verified identical to the per-competitor RPC. Cut competitive load
--     concurrency (5 timeseries calls -> 1); dev wall-clock ~11-16s -> ~6.5s.
CREATE OR REPLACE FUNCTION get_competitor_timeseries_multi_rpc(
  p_competitors text[], p_start_day date, p_end_day date,
  p_prompt_type text DEFAULT 'all', p_platforms text[] DEFAULT NULL
) RETURNS TABLE(competitor text, date text, competitor_vis double precision)
LANGUAGE sql STABLE SET statement_timeout='30000' AS $$
  WITH d AS (SELECT run_day, SUM(total_responses) total FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day AND (p_platforms IS NULL OR platform=ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type) GROUP BY run_day),
  cc AS (SELECT competitor_name, run_day, SUM(mention_count) m FROM aeo_cache_competitors
    WHERE competitor_name = ANY(p_competitors) AND run_day BETWEEN p_start_day AND p_end_day AND (p_platforms IS NULL OR platform=ANY(p_platforms)) AND (p_prompt_type='all' OR prompt_type ILIKE p_prompt_type) GROUP BY competitor_name, run_day)
  SELECT cc.competitor_name, cc.run_day::text, CASE WHEN d.total>0 THEN cc.m::double precision/d.total*100 ELSE 0 END
  FROM cc JOIN d ON d.run_day = cc.run_day ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION get_competitor_timeseries_multi_rpc(text[],date,date,text,text[]) TO anon, authenticated;

-- ============================================================
-- RESULT: Competitive-tab load requests 227 -> ~12; ALL client-side crawls
-- eliminated (every aggregation is now a server-side RPC).
--
-- REMAINING (further tuning, not blocking): ~10 RPCs fire concurrently on load
-- and contend on the small Supabase instance (~11s dev wall-clock). Options:
--   * combine the 5 get_competitor_timeseries_rpc calls into one multi-competitor RPC
--   * materialize the all-time competitor list (get_competitor_list_rpc scans 321k rows)
--   * source get_distinct_tags from a smaller table
-- ============================================================
