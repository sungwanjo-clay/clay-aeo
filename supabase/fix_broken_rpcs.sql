-- ============================================================
-- fix_broken_rpcs.sql
-- Fixes for 4 RPCs that error/return empty with NULL prev dates
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ── DIAGNOSTIC: run first to confirm function language ───────
-- SELECT routine_name,
--        CASE WHEN routine_definition ILIKE '%plpgsql%' OR external_language = 'PLPGSQL' THEN 'plpgsql' ELSE 'sql' END AS lang
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
-- AND routine_name IN (
--   'get_claygent_timeseries_rpc','get_competitor_leaderboard_rpc',
--   'get_pmm_table_rpc','get_top_cited_domains_rpc'
-- );


-- ────────────────────────────────────────────────────────────
-- RPC 1 FIX: get_claygent_timeseries_rpc
--   (re-create clean — may have been left as old LANGUAGE sql)
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_claygent_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- Fast path: pre-aggregated cache
    RETURN QUERY
    SELECT
      run_day                     AS date,
      SUM(claygent_mentioned)     AS count
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day
    ORDER BY run_day;
  ELSE
    -- Slow path: live scan
    RETURN QUERY
    SELECT
      r.run_day,
      COUNT(*) FILTER (WHERE r.claygent_or_mcp_mentioned ILIKE 'yes')
    FROM responses r
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
           OR r.platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR r.tags = p_tags)
    GROUP BY r.run_day
    ORDER BY r.run_day;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- RPC 2 FIX: get_competitor_leaderboard_rpc
--   BUG: LEAST(date, NULL) = NULL → BETWEEN NULL AND NULL = FALSE
--   FIX: COALESCE prev dates to current period when NULL
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_competitor_leaderboard_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_competitor_leaderboard_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prev_start_day DATE,
  p_prev_end_day   DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  competitor_name  TEXT,
  mention_count    BIGINT,
  visibility_score FLOAT,
  delta            FLOAT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
DECLARE
  v_prev_start DATE := COALESCE(p_prev_start_day, p_start_day);
  v_prev_end   DATE := COALESCE(p_prev_end_day,   p_end_day);
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path ─────────────────────────────────────────────
    RETURN QUERY
    WITH totals AS (
      SELECT
        SUM(total_responses) FILTER (WHERE run_day BETWEEN p_start_day AND p_end_day)    AS cur_n,
        SUM(total_responses) FILTER (WHERE run_day BETWEEN v_prev_start AND v_prev_end)  AS prev_n
      FROM aeo_cache_daily
      WHERE run_day BETWEEN LEAST(p_start_day, v_prev_start)
                        AND GREATEST(p_end_day, v_prev_end)
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    ),
    comp AS (
      SELECT
        competitor_name,
        SUM(mention_count) FILTER (WHERE run_day BETWEEN p_start_day AND p_end_day)   AS cur_cnt,
        SUM(mention_count) FILTER (WHERE run_day BETWEEN v_prev_start AND v_prev_end)  AS prev_cnt
      FROM aeo_cache_competitors
      WHERE run_day BETWEEN LEAST(p_start_day, v_prev_start)
                        AND GREATEST(p_end_day, v_prev_end)
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY competitor_name
    )
    SELECT
      c.competitor_name,
      c.cur_cnt                                                                AS mention_count,
      CASE WHEN t.cur_n > 0 THEN c.cur_cnt::float / t.cur_n * 100 ELSE 0 END AS visibility_score,
      -- delta is NULL when no compare period was supplied
      CASE
        WHEN p_prev_start_day IS NOT NULL
         AND t.cur_n  > 0
         AND t.prev_n > 0
         AND c.prev_cnt > 0
        THEN c.cur_cnt::float / t.cur_n * 100 - c.prev_cnt::float / t.prev_n * 100
        ELSE NULL
      END                                                                      AS delta
    FROM comp c
    CROSS JOIN totals t
    WHERE c.cur_cnt > 0
    ORDER BY visibility_score DESC
    LIMIT 20;

  ELSE
    -- ── Slow path ─────────────────────────────────────────────
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id,
        (run_day BETWEEN p_start_day AND p_end_day)  AS is_cur,
        (run_day BETWEEN v_prev_start AND v_prev_end) AS is_prev
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, v_prev_start)
                        AND GREATEST(p_end_day, v_prev_end)
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN v_prev_start AND v_prev_end)
    ),
    totals AS (
      SELECT
        COUNT(*) FILTER (WHERE is_cur)  AS cur_n,
        COUNT(*) FILTER (WHERE is_prev) AS prev_n
      FROM filtered
    ),
    comp_counts AS (
      SELECT rc.competitor_name,
        COUNT(*) FILTER (WHERE f.is_cur)  AS cur_cnt,
        COUNT(*) FILTER (WHERE f.is_prev) AS prev_cnt
      FROM filtered f
      JOIN response_competitors rc ON rc.response_id = f.id
      GROUP BY rc.competitor_name
    )
    SELECT
      c.competitor_name,
      c.cur_cnt,
      CASE WHEN t.cur_n > 0 THEN c.cur_cnt::float / t.cur_n * 100 ELSE 0 END,
      CASE
        WHEN p_prev_start_day IS NOT NULL
         AND t.cur_n  > 0
         AND t.prev_n > 0
         AND c.prev_cnt > 0
        THEN c.cur_cnt::float / t.cur_n * 100 - c.prev_cnt::float / t.prev_n * 100
        ELSE NULL
      END
    FROM comp_counts c
    CROSS JOIN totals t
    WHERE c.cur_cnt > 0
    ORDER BY 3 DESC
    LIMIT 20;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_leaderboard_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- RPC 3 FIX: get_pmm_table_rpc
--   BUG: slow path has LEAST/GREATEST NULL on lines 1111-1112
--   FIX: COALESCE prev dates; fast path already safe (no LEAST)
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_pmm_table_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_pmm_table_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prev_start_day DATE,
  p_prev_end_day   DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  pmm_use_case        TEXT,
  pmm_classification  TEXT,
  visibility_score    FLOAT,
  delta               FLOAT,
  citation_share      FLOAT,
  avg_position        FLOAT,
  total_responses     BIGINT,
  timeseries          JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
DECLARE
  v_prev_start DATE := COALESCE(p_prev_start_day, p_start_day);
  v_prev_end   DATE := COALESCE(p_prev_end_day,   p_end_day);
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path ─────────────────────────────────────────────
    RETURN QUERY
    WITH cur AS (
      SELECT
        pmm_use_case,
        pmm_classification,
        SUM(total_responses)  AS total,
        SUM(clay_mentioned)   AS mentioned,
        SUM(clay_cited)       AS clay_cited,
        CASE WHEN SUM(count_position) > 0
          THEN SUM(sum_position) / SUM(count_position) END AS avg_pos
      FROM aeo_cache_pmm
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY pmm_use_case, pmm_classification
    ),
    prev AS (
      SELECT
        pmm_use_case,
        pmm_classification,
        SUM(total_responses) AS total,
        SUM(clay_mentioned)  AS mentioned
      FROM aeo_cache_pmm
      -- When prev dates are NULL, v_prev_start/end = cur dates → prev = cur (delta = 0/NULL)
      WHERE run_day BETWEEN v_prev_start AND v_prev_end
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY pmm_use_case, pmm_classification
    ),
    ts_daily AS (
      SELECT
        pmm_use_case,
        pmm_classification,
        run_day,
        SUM(total_responses) AS day_total,
        SUM(clay_mentioned)  AS day_mentioned
      FROM aeo_cache_pmm
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY pmm_use_case, pmm_classification, run_day
    ),
    ts_agg AS (
      SELECT
        pmm_use_case,
        pmm_classification,
        jsonb_agg(
          jsonb_build_object(
            'date',  run_day::text,
            'value', CASE WHEN day_total > 0
                          THEN day_mentioned::float / day_total * 100
                          ELSE 0 END
          ) ORDER BY run_day
        ) AS timeseries
      FROM ts_daily
      GROUP BY pmm_use_case, pmm_classification
    )
    SELECT
      c.pmm_use_case,
      c.pmm_classification,
      CASE WHEN c.total > 0 THEN c.mentioned::float / c.total * 100 ELSE 0 END         AS visibility_score,
      CASE
        WHEN p_prev_start_day IS NOT NULL AND c.total > 0 AND p.total > 0
        THEN c.mentioned::float / c.total * 100 - p.mentioned::float / p.total * 100
        ELSE NULL
      END                                                                                AS delta,
      CASE WHEN c.total > 0 THEN c.clay_cited::float / c.total * 100 ELSE NULL END      AS citation_share,
      c.avg_pos,
      c.total,
      COALESCE(t.timeseries, '[]'::jsonb)
    FROM cur c
    LEFT JOIN prev   p USING (pmm_use_case, pmm_classification)
    LEFT JOIN ts_agg t USING (pmm_use_case, pmm_classification)
    ORDER BY c.pmm_use_case, visibility_score DESC;

  ELSE
    -- ── Slow path ─────────────────────────────────────────────
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        (run_day BETWEEN p_start_day AND p_end_day)    AS is_cur,
        (run_day BETWEEN v_prev_start AND v_prev_end)   AS is_prev,
        run_day, pmm_use_case, pmm_classification,
        clay_mentioned,
        clay_mention_position::float,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, v_prev_start)
                        AND GREATEST(p_end_day, v_prev_end)
        AND pmm_use_case IS NOT NULL
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN v_prev_start AND v_prev_end)
    ),
    cur_by_pmm AS (
      SELECT pmm_use_case, pmm_classification,
        COUNT(*)                                                           AS total,
        COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')                AS mentioned,
        COUNT(*) FILTER (WHERE has_clay)                                   AS clay_cited,
        AVG(clay_mention_position)
          FILTER (WHERE clay_mentioned ILIKE 'yes'
                    AND clay_mention_position IS NOT NULL)                 AS avg_pos
      FROM filtered WHERE is_cur
      GROUP BY pmm_use_case, pmm_classification
    ),
    prev_by_pmm AS (
      SELECT pmm_use_case, pmm_classification,
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes') AS mentioned
      FROM filtered WHERE is_prev
      GROUP BY pmm_use_case, pmm_classification
    ),
    ts_by_day AS (
      SELECT pmm_use_case, pmm_classification, run_day,
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes') AS mentioned
      FROM filtered WHERE is_cur
      GROUP BY pmm_use_case, pmm_classification, run_day
    ),
    ts_agg AS (
      SELECT pmm_use_case, pmm_classification,
        jsonb_agg(jsonb_build_object(
          'date',  run_day::text,
          'value', CASE WHEN total > 0 THEN mentioned::float / total * 100 ELSE 0 END
        ) ORDER BY run_day) AS timeseries
      FROM ts_by_day
      GROUP BY pmm_use_case, pmm_classification
    )
    SELECT
      c.pmm_use_case, c.pmm_classification,
      CASE WHEN c.total > 0 THEN c.mentioned::float / c.total * 100 ELSE 0 END,
      CASE
        WHEN p_prev_start_day IS NOT NULL AND c.total > 0 AND p.total > 0
        THEN c.mentioned::float / c.total * 100 - p.mentioned::float / p.total * 100
        ELSE NULL
      END,
      CASE WHEN c.total > 0 THEN c.clay_cited::float / c.total * 100 ELSE NULL END,
      c.avg_pos, c.total,
      COALESCE(t.timeseries, '[]'::jsonb)
    FROM cur_by_pmm c
    LEFT JOIN prev_by_pmm p USING (pmm_use_case, pmm_classification)
    LEFT JOIN ts_agg      t USING (pmm_use_case, pmm_classification)
    ORDER BY c.pmm_use_case, 3 DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pmm_table_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- RPC 4 FIX: get_top_cited_domains_rpc
--   (re-create clean — may have been left as old LANGUAGE sql)
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_top_cited_domains_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_top_cited_domains_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  domain         TEXT,
  citation_count BIGINT,
  share_pct      FLOAT,
  is_clay        BOOLEAN,
  citation_type  TEXT,
  top_urls       JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path ─────────────────────────────────────────────
    RETURN QUERY
    WITH domain_agg AS (
      SELECT
        domain,
        SUM(response_count)                                AS response_count,
        mode() WITHIN GROUP (ORDER BY citation_type)       AS citation_type,
        BOOL_OR(domain LIKE '%clay.com%')                  AS is_clay
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY domain
      ORDER BY SUM(response_count) DESC
      LIMIT 20
    ),
    total_cited AS (
      SELECT SUM(response_count)::float AS n FROM domain_agg
    ),
    url_agg AS (
      SELECT
        domain,
        url,
        MAX(title)      AS title,
        SUM(url_count)  AS cnt,
        ROW_NUMBER() OVER (PARTITION BY domain ORDER BY SUM(url_count) DESC) AS rn
      FROM aeo_cache_domain_urls
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND domain IN (SELECT domain FROM domain_agg)
      GROUP BY domain, url
    ),
    top_urls AS (
      SELECT domain,
        jsonb_agg(
          jsonb_build_object('url', url, 'title', title, 'count', cnt)
          ORDER BY cnt DESC
        ) AS top_urls
      FROM url_agg WHERE rn <= 8
      GROUP BY domain
    )
    SELECT
      d.domain,
      d.response_count,
      CASE WHEN tc.n > 0 THEN d.response_count::float / tc.n * 100 ELSE 0 END,
      d.is_clay,
      d.citation_type,
      COALESCE(u.top_urls, '[]'::jsonb)
    FROM domain_agg d
    CROSS JOIN total_cited tc
    LEFT JOIN top_urls u USING (domain)
    ORDER BY d.response_count DESC;

  ELSE
    -- ── Slow path ─────────────────────────────────────────────
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    citations AS (
      SELECT LOWER(cd.domain) AS domain, cd.url, cd.title,
             cd.citation_type, cd.response_id
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    total_cited AS (
      SELECT COUNT(DISTINCT response_id)::float AS n FROM citations
    ),
    domain_stats AS (
      SELECT domain,
        COUNT(DISTINCT response_id)                  AS response_count,
        BOOL_OR(domain LIKE '%clay.com%')            AS is_clay,
        mode() WITHIN GROUP (ORDER BY citation_type) AS citation_type
      FROM citations
      GROUP BY domain
    ),
    url_ranked AS (
      SELECT domain, url, MAX(title) AS title, COUNT(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY domain ORDER BY COUNT(*) DESC) AS rn
      FROM citations WHERE url IS NOT NULL
      GROUP BY domain, url
    ),
    top_urls AS (
      SELECT domain,
        jsonb_agg(
          jsonb_build_object('url', url, 'title', title, 'count', cnt)
          ORDER BY cnt DESC
        ) AS top_urls
      FROM url_ranked WHERE rn <= 8
      GROUP BY domain
    )
    SELECT
      ds.domain, ds.response_count,
      CASE WHEN tc.n > 0 THEN ds.response_count::float / tc.n * 100 ELSE 0 END,
      ds.is_clay, ds.citation_type,
      COALESCE(tu.top_urls, '[]'::jsonb)
    FROM domain_stats ds
    CROSS JOIN total_cited tc
    LEFT JOIN top_urls tu USING (domain)
    ORDER BY ds.response_count DESC
    LIMIT 20;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_top_cited_domains_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- VALIDATION: run these after the functions above succeed
-- ────────────────────────────────────────────────────────────
-- Test 1 – ClayMCP/Agent timeseries (should show daily counts)
-- SELECT * FROM get_claygent_timeseries_rpc(
--   '2026-04-03'::date, '2026-04-11'::date, 'Benchmark', '{}'::text[], 'all', 'all'
-- );

-- Test 2 – Competitor leaderboard, no compare period (NULL prev dates)
-- SELECT * FROM get_competitor_leaderboard_rpc(
--   '2026-04-03'::date, '2026-04-11'::date, NULL::date, NULL::date,
--   'Benchmark', '{}'::text[], 'all', 'all'
-- );

-- Test 3 – PMM table, no compare period
-- SELECT * FROM get_pmm_table_rpc(
--   '2026-04-03'::date, '2026-04-11'::date, NULL::date, NULL::date,
--   'Benchmark', '{}'::text[], 'all', 'all'
-- );

-- Test 4 – Top cited domains
-- SELECT domain, citation_count, share_pct FROM get_top_cited_domains_rpc(
--   '2026-04-03'::date, '2026-04-11'::date, 'Benchmark', '{}'::text[], 'all', 'all'
-- ) LIMIT 10;
