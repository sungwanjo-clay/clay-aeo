-- ============================================================
-- fix_all_rpcs.sql  —  fixes all 6 broken RPCs
--
-- Bug A (1c, 3f): SUM(bigint) returns numeric inside plpgsql
--   RETURN QUERY → need explicit ::BIGINT casts
-- Bug B (2a, 3b, 3c, 3e): plpgsql RETURNS TABLE column names
--   (competitor_name, domain, pmm_use_case) shadow CTE column
--   names → "ambiguous reference" error → fix with table aliases
-- ============================================================


-- ── FIX 1: get_claygent_timeseries_rpc  (Bug A: numeric→bigint) ──
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
    RETURN QUERY
    SELECT
      d.run_day,
      SUM(d.claygent_mentioned)::BIGINT        -- explicit cast: SUM→numeric in plpgsql
    FROM aeo_cache_daily d
    WHERE d.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
    GROUP BY d.run_day
    ORDER BY d.run_day;
  ELSE
    RETURN QUERY
    SELECT
      r.run_day,
      COUNT(*) FILTER (WHERE r.claygent_or_mcp_mentioned ILIKE 'yes')::BIGINT
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


-- ── FIX 2: get_sentiment_breakdown_rpc  (Bug A: numeric→bigint) ──
DROP FUNCTION IF EXISTS get_sentiment_breakdown_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_sentiment_breakdown_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  total_count      BIGINT,
  mentioned_count  BIGINT,
  positive_count   BIGINT,
  neutral_count    BIGINT,
  negative_count   BIGINT,
  avg_score        FLOAT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      COALESCE(SUM(d.total_responses),    0)::BIGINT,
      COALESCE(SUM(d.clay_mentioned),     0)::BIGINT,
      COALESCE(SUM(d.positive_sentiment), 0)::BIGINT,
      COALESCE(SUM(d.neutral_sentiment),  0)::BIGINT,
      COALESCE(SUM(d.negative_sentiment), 0)::BIGINT,
      CASE WHEN SUM(d.count_sentiment_score) > 0
        THEN SUM(d.sum_sentiment_score) / SUM(d.count_sentiment_score) END
    FROM aeo_cache_daily d
    WHERE d.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type);
  ELSE
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')::BIGINT,
      COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Positive')::BIGINT,
      COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Neutral')::BIGINT,
      COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Negative')::BIGINT,
      AVG(r.brand_sentiment_score::float)
        FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL)
    FROM responses r
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
           OR r.platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR r.tags = p_tags);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_breakdown_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── FIX 3: get_competitor_leaderboard_rpc  (Bug B: competitor_name ambiguous) ──
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
    RETURN QUERY
    WITH totals AS (
      SELECT
        SUM(d.total_responses) FILTER (WHERE d.run_day BETWEEN p_start_day AND p_end_day)   AS cur_n,
        SUM(d.total_responses) FILTER (WHERE d.run_day BETWEEN v_prev_start AND v_prev_end)  AS prev_n
      FROM aeo_cache_daily d
      WHERE d.run_day BETWEEN LEAST(p_start_day, v_prev_start)
                          AND GREATEST(p_end_day, v_prev_end)
        AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
    ),
    comp AS (
      -- alias table as cc to avoid clash with RETURNS TABLE's "competitor_name" variable
      SELECT
        cc.competitor_name                                                                         AS cname,
        SUM(cc.mention_count) FILTER (WHERE cc.run_day BETWEEN p_start_day AND p_end_day)         AS cur_cnt,
        SUM(cc.mention_count) FILTER (WHERE cc.run_day BETWEEN v_prev_start AND v_prev_end)        AS prev_cnt
      FROM aeo_cache_competitors cc
      WHERE cc.run_day BETWEEN LEAST(p_start_day, v_prev_start)
                           AND GREATEST(p_end_day, v_prev_end)
        AND (array_length(p_platforms,1) IS NULL OR cc.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR cc.prompt_type ILIKE p_prompt_type)
      GROUP BY cc.competitor_name
    )
    SELECT
      c.cname,
      c.cur_cnt::BIGINT,
      CASE WHEN t.cur_n > 0 THEN c.cur_cnt::float / t.cur_n * 100 ELSE 0 END,
      CASE
        WHEN p_prev_start_day IS NOT NULL
         AND t.cur_n  > 0 AND t.prev_n > 0 AND c.prev_cnt > 0
        THEN c.cur_cnt::float / t.cur_n * 100 - c.prev_cnt::float / t.prev_n * 100
        ELSE NULL
      END
    FROM comp c
    CROSS JOIN totals t
    WHERE c.cur_cnt > 0
    ORDER BY 3 DESC
    LIMIT 20;

  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT r.id,
        (r.run_day BETWEEN p_start_day AND p_end_day)    AS is_cur,
        (r.run_day BETWEEN v_prev_start AND v_prev_end)   AS is_prev
      FROM responses r
      WHERE r.run_day BETWEEN LEAST(p_start_day, v_prev_start)
                          AND GREATEST(p_end_day, v_prev_end)
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
        AND (r.run_day BETWEEN p_start_day AND p_end_day
             OR r.run_day BETWEEN v_prev_start AND v_prev_end)
    ),
    totals AS (
      SELECT
        COUNT(*) FILTER (WHERE f.is_cur)  AS cur_n,
        COUNT(*) FILTER (WHERE f.is_prev) AS prev_n
      FROM filtered f
    ),
    comp_counts AS (
      SELECT rc.competitor_name                                   AS cname,
        COUNT(*) FILTER (WHERE f.is_cur)::BIGINT                  AS cur_cnt,
        COUNT(*) FILTER (WHERE f.is_prev)::BIGINT                 AS prev_cnt
      FROM filtered f
      JOIN response_competitors rc ON rc.response_id = f.id
      GROUP BY rc.competitor_name
    )
    SELECT
      c.cname,
      c.cur_cnt,
      CASE WHEN t.cur_n > 0 THEN c.cur_cnt::float / t.cur_n * 100 ELSE 0 END,
      CASE
        WHEN p_prev_start_day IS NOT NULL
         AND t.cur_n  > 0 AND t.prev_n > 0 AND c.prev_cnt > 0
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


-- ── FIX 4: get_top_cited_domains_rpc  (Bug B: domain ambiguous) ──
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
    RETURN QUERY
    WITH domain_agg AS (
      -- alias table as acd to avoid clash with RETURNS TABLE's "domain" variable
      SELECT
        acd.domain                                              AS dname,
        SUM(acd.response_count)                                AS response_count,
        mode() WITHIN GROUP (ORDER BY acd.citation_type)       AS ctype,
        BOOL_OR(acd.domain LIKE '%clay.com%')                  AS is_clay
      FROM aeo_cache_domains acd
      WHERE acd.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd.prompt_type ILIKE p_prompt_type)
      GROUP BY acd.domain
      ORDER BY SUM(acd.response_count) DESC
      LIMIT 20
    ),
    total_cited AS (
      SELECT SUM(da.response_count)::float AS n FROM domain_agg da
    ),
    url_agg AS (
      SELECT
        du.domain                                                                     AS dname,
        du.url,
        MAX(du.title)                                                                 AS title,
        SUM(du.url_count)                                                             AS cnt,
        ROW_NUMBER() OVER (PARTITION BY du.domain ORDER BY SUM(du.url_count) DESC)   AS rn
      FROM aeo_cache_domain_urls du
      WHERE du.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR du.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR du.prompt_type ILIKE p_prompt_type)
        AND du.domain IN (SELECT da.dname FROM domain_agg da)
      GROUP BY du.domain, du.url
    ),
    top_urls AS (
      SELECT ua.dname,
        jsonb_agg(
          jsonb_build_object('url', ua.url, 'title', ua.title, 'count', ua.cnt)
          ORDER BY ua.cnt DESC
        ) AS top_urls
      FROM url_agg ua
      WHERE ua.rn <= 8
      GROUP BY ua.dname
    )
    SELECT
      da.dname,
      da.response_count::BIGINT,
      CASE WHEN tc.n > 0 THEN da.response_count::float / tc.n * 100 ELSE 0 END,
      da.is_clay,
      da.ctype,
      COALESCE(tu.top_urls, '[]'::jsonb)
    FROM domain_agg da
    CROSS JOIN total_cited tc
    LEFT JOIN top_urls tu ON tu.dname = da.dname
    ORDER BY da.response_count DESC;

  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT r.id FROM responses r
      WHERE r.run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
    ),
    citations AS (
      SELECT LOWER(cd.domain) AS dname, cd.url, cd.title,
             cd.citation_type, cd.response_id
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    total_cited AS (
      SELECT COUNT(DISTINCT c.response_id)::float AS n FROM citations c
    ),
    domain_stats AS (
      SELECT c.dname,
        COUNT(DISTINCT c.response_id)::BIGINT                AS response_count,
        BOOL_OR(c.dname LIKE '%clay.com%')                   AS is_clay,
        mode() WITHIN GROUP (ORDER BY c.citation_type)       AS ctype
      FROM citations c
      GROUP BY c.dname
    ),
    url_ranked AS (
      SELECT c.dname, c.url, MAX(c.title) AS title, COUNT(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY c.dname ORDER BY COUNT(*) DESC) AS rn
      FROM citations c WHERE c.url IS NOT NULL
      GROUP BY c.dname, c.url
    ),
    top_urls AS (
      SELECT ur.dname,
        jsonb_agg(
          jsonb_build_object('url', ur.url, 'title', ur.title, 'count', ur.cnt)
          ORDER BY ur.cnt DESC
        ) AS top_urls
      FROM url_ranked ur WHERE ur.rn <= 8
      GROUP BY ur.dname
    )
    SELECT
      ds.dname, ds.response_count,
      CASE WHEN tc.n > 0 THEN ds.response_count::float / tc.n * 100 ELSE 0 END,
      ds.is_clay, ds.ctype,
      COALESCE(tu.top_urls, '[]'::jsonb)
    FROM domain_stats ds
    CROSS JOIN total_cited tc
    LEFT JOIN top_urls tu ON tu.dname = ds.dname
    ORDER BY ds.response_count DESC
    LIMIT 20;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_top_cited_domains_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── FIX 5: get_competitor_citation_timeseries_rpc  (Bug B: domain ambiguous) ──
DROP FUNCTION IF EXISTS get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT);

CREATE FUNCTION get_competitor_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_top_n          INT     DEFAULT 5
)
RETURNS TABLE(date DATE, domain TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH daily_totals AS (
      SELECT acd.run_day, SUM(acd.response_count) AS total_cited
      FROM aeo_cache_domains acd
      WHERE acd.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd.prompt_type ILIKE p_prompt_type)
      GROUP BY acd.run_day
    ),
    top_competitors AS (
      -- alias to avoid clash with RETURNS TABLE "domain" variable
      SELECT acd2.domain AS dname
      FROM aeo_cache_domains acd2
      WHERE acd2.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd2.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd2.prompt_type ILIKE p_prompt_type)
        AND acd2.citation_type = 'Competition'
        AND acd2.domain NOT LIKE '%clay%'
      GROUP BY acd2.domain
      ORDER BY SUM(acd2.response_count) DESC
      LIMIT p_top_n
    ),
    relevant AS (
      SELECT tc.dname FROM top_competitors tc
      UNION SELECT 'clay.com'
    ),
    domain_day AS (
      SELECT acd3.run_day, acd3.domain AS dname, SUM(acd3.response_count) AS cnt
      FROM aeo_cache_domains acd3
      WHERE acd3.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd3.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd3.prompt_type ILIKE p_prompt_type)
        AND acd3.domain IN (SELECT r.dname FROM relevant r)
      GROUP BY acd3.run_day, acd3.domain
    )
    SELECT dd.run_day, dd.dname,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd
    JOIN daily_totals dt ON dt.run_day = dd.run_day
    ORDER BY dd.run_day, dd.dname;

  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT r.id, r.run_day FROM responses r
      WHERE r.run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
    ),
    cited AS (
      SELECT f.run_day, f.id AS response_id,
        CASE WHEN LOWER(cd.domain) LIKE '%clay.com%' THEN 'clay.com'
             ELSE LOWER(cd.domain) END AS dname,
        cd.citation_type
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    daily_totals AS (
      SELECT c.run_day, COUNT(DISTINCT c.response_id) AS total_cited
      FROM cited c GROUP BY c.run_day
    ),
    top_competitors AS (
      SELECT c2.dname
      FROM cited c2
      WHERE c2.citation_type = 'Competition' AND c2.dname NOT LIKE '%clay%'
      GROUP BY c2.dname
      ORDER BY COUNT(DISTINCT c2.response_id) DESC
      LIMIT p_top_n
    ),
    domain_day AS (
      SELECT c3.run_day, c3.dname, COUNT(DISTINCT c3.response_id) AS cnt
      FROM cited c3
      WHERE c3.dname IN (
        SELECT tc.dname FROM top_competitors tc
        UNION SELECT 'clay.com'
      )
      GROUP BY c3.run_day, c3.dname
    )
    SELECT dd.run_day, dd.dname,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd
    JOIN daily_totals dt ON dt.run_day = dd.run_day
    ORDER BY dd.run_day, dd.dname;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT)
  TO anon, authenticated;


-- ── FIX 6: get_pmm_table_rpc  (Bug B: pmm_use_case ambiguous) ──
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
    RETURN QUERY
    WITH cur AS (
      -- alias table as pm to avoid clash with RETURNS TABLE column names
      SELECT
        pm.pmm_use_case        AS uc,
        pm.pmm_classification  AS cls,
        SUM(pm.total_responses)                                                    AS total,
        SUM(pm.clay_mentioned)                                                     AS mentioned,
        SUM(pm.clay_cited)                                                         AS clay_cited,
        CASE WHEN SUM(pm.count_position) > 0
          THEN SUM(pm.sum_position) / SUM(pm.count_position) END                   AS avg_pos
      FROM aeo_cache_pmm pm
      WHERE pm.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR pm.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR pm.prompt_type ILIKE p_prompt_type)
      GROUP BY pm.pmm_use_case, pm.pmm_classification
    ),
    prev AS (
      SELECT
        pm2.pmm_use_case        AS uc,
        pm2.pmm_classification  AS cls,
        SUM(pm2.total_responses) AS total,
        SUM(pm2.clay_mentioned)  AS mentioned
      FROM aeo_cache_pmm pm2
      WHERE pm2.run_day BETWEEN v_prev_start AND v_prev_end
        AND (array_length(p_platforms,1) IS NULL OR pm2.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR pm2.prompt_type ILIKE p_prompt_type)
      GROUP BY pm2.pmm_use_case, pm2.pmm_classification
    ),
    ts_daily AS (
      SELECT
        pm3.pmm_use_case        AS uc,
        pm3.pmm_classification  AS cls,
        pm3.run_day,
        SUM(pm3.total_responses) AS day_total,
        SUM(pm3.clay_mentioned)  AS day_mentioned
      FROM aeo_cache_pmm pm3
      WHERE pm3.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR pm3.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR pm3.prompt_type ILIKE p_prompt_type)
      GROUP BY pm3.pmm_use_case, pm3.pmm_classification, pm3.run_day
    ),
    ts_agg AS (
      SELECT td.uc, td.cls,
        jsonb_agg(
          jsonb_build_object(
            'date',  td.run_day::text,
            'value', CASE WHEN td.day_total > 0
                          THEN td.day_mentioned::float / td.day_total * 100
                          ELSE 0 END
          ) ORDER BY td.run_day
        ) AS timeseries
      FROM ts_daily td
      GROUP BY td.uc, td.cls
    )
    SELECT
      c.uc,
      c.cls,
      CASE WHEN c.total > 0 THEN c.mentioned::float / c.total * 100 ELSE 0 END,
      CASE
        WHEN p_prev_start_day IS NOT NULL AND c.total > 0 AND p.total > 0
        THEN c.mentioned::float / c.total * 100 - p.mentioned::float / p.total * 100
        ELSE NULL
      END,
      CASE WHEN c.total > 0 THEN c.clay_cited::float / c.total * 100 ELSE NULL END,
      c.avg_pos,
      c.total::BIGINT,
      COALESCE(t.timeseries, '[]'::jsonb)
    FROM cur c
    LEFT JOIN prev   p ON p.uc = c.uc AND p.cls = c.cls
    LEFT JOIN ts_agg t ON t.uc = c.uc AND t.cls = c.cls
    ORDER BY c.uc, 3 DESC;

  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        (r.run_day BETWEEN p_start_day AND p_end_day)    AS is_cur,
        (r.run_day BETWEEN v_prev_start AND v_prev_end)   AS is_prev,
        r.run_day, r.pmm_use_case, r.pmm_classification,
        r.clay_mentioned,
        r.clay_mention_position::float,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(r.cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses r
      WHERE r.run_day BETWEEN LEAST(p_start_day, v_prev_start)
                          AND GREATEST(p_end_day, v_prev_end)
        AND r.pmm_use_case IS NOT NULL
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
        AND (r.run_day BETWEEN p_start_day AND p_end_day
             OR r.run_day BETWEEN v_prev_start AND v_prev_end)
    ),
    cur_by_pmm AS (
      SELECT f.pmm_use_case AS uc, f.pmm_classification AS cls,
        COUNT(*)::BIGINT                                                              AS total,
        COUNT(*) FILTER (WHERE f.clay_mentioned ILIKE 'yes')::BIGINT                  AS mentioned,
        COUNT(*) FILTER (WHERE f.has_clay)::BIGINT                                    AS clay_cited,
        AVG(f.clay_mention_position)
          FILTER (WHERE f.clay_mentioned ILIKE 'yes'
                    AND f.clay_mention_position IS NOT NULL)                           AS avg_pos
      FROM filtered f WHERE f.is_cur
      GROUP BY f.pmm_use_case, f.pmm_classification
    ),
    prev_by_pmm AS (
      SELECT f.pmm_use_case AS uc, f.pmm_classification AS cls,
        COUNT(*)::BIGINT                                                         AS total,
        COUNT(*) FILTER (WHERE f.clay_mentioned ILIKE 'yes')::BIGINT             AS mentioned
      FROM filtered f WHERE f.is_prev
      GROUP BY f.pmm_use_case, f.pmm_classification
    ),
    ts_by_day AS (
      SELECT f.pmm_use_case AS uc, f.pmm_classification AS cls, f.run_day,
        COUNT(*)::BIGINT                                          AS total,
        COUNT(*) FILTER (WHERE f.clay_mentioned ILIKE 'yes')::BIGINT AS mentioned
      FROM filtered f WHERE f.is_cur
      GROUP BY f.pmm_use_case, f.pmm_classification, f.run_day
    ),
    ts_agg AS (
      SELECT td.uc, td.cls,
        jsonb_agg(jsonb_build_object(
          'date',  td.run_day::text,
          'value', CASE WHEN td.total > 0 THEN td.mentioned::float / td.total * 100 ELSE 0 END
        ) ORDER BY td.run_day) AS timeseries
      FROM ts_by_day td
      GROUP BY td.uc, td.cls
    )
    SELECT
      c.uc, c.cls,
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
    LEFT JOIN prev_by_pmm p ON p.uc = c.uc AND p.cls = c.cls
    LEFT JOIN ts_agg      t ON t.uc = c.uc AND t.cls = c.cls
    ORDER BY c.uc, 3 DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pmm_table_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
