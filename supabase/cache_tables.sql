-- ============================================================
-- Clay AEO — Pre-aggregated Dashboard Cache
-- ============================================================
-- Run this file ONCE in the Supabase SQL Editor, then call:
--   SELECT refresh_dashboard_cache();
--
-- After each daily Clay ingestion, call refresh again.
--
-- HOW IT WORKS:
--   Six tiny cache tables store pre-aggregated metrics at
--   (run_day, platform, prompt_type) granularity.
--   All dashboard RPCs query these tables instead of scanning
--   the full responses table — making every query instant.
--
--   When p_branded_filter ≠ 'all' or p_tags ≠ 'all', RPCs
--   fall back to the original live responses query automatically.
-- ============================================================


-- ── Cache Table 1: Core daily metrics ───────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_daily (
  run_day               DATE    NOT NULL,
  platform              TEXT    NOT NULL,
  prompt_type           TEXT    NOT NULL,
  total_responses       BIGINT  NOT NULL DEFAULT 0,
  clay_mentioned        BIGINT  NOT NULL DEFAULT 0,
  claygent_mentioned    BIGINT  NOT NULL DEFAULT 0,
  clay_followup         BIGINT  NOT NULL DEFAULT 0,
  clay_cited_responses  BIGINT  NOT NULL DEFAULT 0,
  total_with_citations  BIGINT  NOT NULL DEFAULT 0,
  sum_position          FLOAT,
  count_position        BIGINT  NOT NULL DEFAULT 0,
  positive_sentiment    BIGINT  NOT NULL DEFAULT 0,
  neutral_sentiment     BIGINT  NOT NULL DEFAULT 0,
  negative_sentiment    BIGINT  NOT NULL DEFAULT 0,
  sum_sentiment_score   FLOAT,
  count_sentiment_score BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (run_day, platform, prompt_type)
);

-- ── Cache Table 2: Competitor mentions ──────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_competitors (
  run_day         DATE    NOT NULL,
  platform        TEXT    NOT NULL,
  prompt_type     TEXT    NOT NULL,
  competitor_name TEXT    NOT NULL,
  mention_count   BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (run_day, platform, prompt_type, competitor_name)
);

-- ── Cache Table 3: PMM metrics ───────────────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_pmm (
  run_day            DATE    NOT NULL,
  platform           TEXT    NOT NULL,
  prompt_type        TEXT    NOT NULL,
  pmm_use_case       TEXT    NOT NULL,
  pmm_classification TEXT    NOT NULL,
  total_responses    BIGINT  NOT NULL DEFAULT 0,
  clay_mentioned     BIGINT  NOT NULL DEFAULT 0,
  clay_cited         BIGINT  NOT NULL DEFAULT 0,
  sum_position       FLOAT,
  count_position     BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (run_day, platform, prompt_type, pmm_use_case, pmm_classification)
);

-- ── Cache Table 4: Domain citations ─────────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_domains (
  run_day        DATE    NOT NULL,
  platform       TEXT    NOT NULL,
  prompt_type    TEXT    NOT NULL,
  domain         TEXT    NOT NULL,
  citation_type  TEXT,
  response_count BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (run_day, platform, prompt_type, domain)
);

-- ── Cache Table 5: Domain URLs (for top-cited table) ────────

CREATE TABLE IF NOT EXISTS aeo_cache_domain_urls (
  run_day    DATE    NOT NULL,
  platform   TEXT    NOT NULL,
  prompt_type TEXT   NOT NULL,
  domain     TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  title      TEXT,
  url_count  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (run_day, platform, prompt_type, domain, url)
);

-- ── Cache Table 6: Topic visibility ─────────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_topics (
  run_day         DATE    NOT NULL,
  platform        TEXT    NOT NULL,
  prompt_type     TEXT    NOT NULL,
  topic           TEXT    NOT NULL,
  total_responses BIGINT  NOT NULL DEFAULT 0,
  clay_mentioned  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (run_day, platform, prompt_type, topic)
);

-- ── Indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_aeo_cache_daily_run_day    ON aeo_cache_daily    (run_day);
CREATE INDEX IF NOT EXISTS idx_aeo_cache_comp_run_day     ON aeo_cache_competitors (run_day);
CREATE INDEX IF NOT EXISTS idx_aeo_cache_pmm_run_day      ON aeo_cache_pmm      (run_day);
CREATE INDEX IF NOT EXISTS idx_aeo_cache_dom_run_day      ON aeo_cache_domains  (run_day);
CREATE INDEX IF NOT EXISTS idx_aeo_cache_dom_urls_run_day ON aeo_cache_domain_urls (run_day);
CREATE INDEX IF NOT EXISTS idx_aeo_cache_topics_run_day   ON aeo_cache_topics   (run_day);


-- ============================================================
-- refresh_dashboard_cache()
-- ============================================================
-- Truncates and rebuilds all 6 cache tables from source data.
-- Run after every daily Clay ingestion (takes a few seconds).
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_dashboard_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300000'   -- 5 min: runs post-ingestion, not user-facing
AS $$
BEGIN
  TRUNCATE
    aeo_cache_daily,
    aeo_cache_competitors,
    aeo_cache_pmm,
    aeo_cache_domains,
    aeo_cache_domain_urls,
    aeo_cache_topics;

  -- ── 1. Core daily metrics ──────────────────────────────────
  INSERT INTO aeo_cache_daily (
    run_day, platform, prompt_type,
    total_responses, clay_mentioned, claygent_mentioned, clay_followup,
    clay_cited_responses, total_with_citations,
    sum_position, count_position,
    positive_sentiment, neutral_sentiment, negative_sentiment,
    sum_sentiment_score, count_sentiment_score
  )
  SELECT
    run_day,
    platform,
    COALESCE(prompt_type, '__none__')                                        AS prompt_type,
    COUNT(*)                                                                 AS total_responses,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')                      AS clay_mentioned,
    COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')           AS claygent_mentioned,
    COUNT(*) FILTER (WHERE clay_recommended_followup ILIKE 'yes')           AS clay_followup,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(cited_domains) d
      WHERE d ILIKE '%clay%'
    ))                                                                       AS clay_cited_responses,
    COUNT(*) FILTER (
      WHERE cited_domains IS NOT NULL AND jsonb_array_length(cited_domains) > 0
    )                                                                        AS total_with_citations,
    SUM(clay_mention_position::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL)
                                                                             AS sum_position,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL)
                                                                             AS count_position,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Positive')
                                                                             AS positive_sentiment,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Neutral')
                                                                             AS neutral_sentiment,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Negative')
                                                                             AS negative_sentiment,
    SUM(brand_sentiment_score::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment_score IS NOT NULL)
                                                                             AS sum_sentiment_score,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment_score IS NOT NULL)
                                                                             AS count_sentiment_score
  FROM responses
  GROUP BY run_day, platform, COALESCE(prompt_type, '__none__');

  -- ── 2. Competitor mentions ─────────────────────────────────
  INSERT INTO aeo_cache_competitors (
    run_day, platform, prompt_type, competitor_name, mention_count
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')   AS prompt_type,
    rc.competitor_name,
    COUNT(*)                              AS mention_count
  FROM response_competitors rc
  JOIN responses r ON r.id = rc.response_id
  WHERE rc.competitor_name IS NOT NULL
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), rc.competitor_name;

  -- ── 3. PMM metrics ─────────────────────────────────────────
  INSERT INTO aeo_cache_pmm (
    run_day, platform, prompt_type,
    pmm_use_case, pmm_classification,
    total_responses, clay_mentioned, clay_cited,
    sum_position, count_position
  )
  SELECT
    run_day,
    platform,
    COALESCE(prompt_type, '__none__')                                        AS prompt_type,
    pmm_use_case,
    COALESCE(pmm_classification, '__none__')                                 AS pmm_classification,
    COUNT(*)                                                                 AS total_responses,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')                      AS clay_mentioned,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(cited_domains) d
      WHERE d ILIKE '%clay%'
    ))                                                                       AS clay_cited,
    SUM(clay_mention_position::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL)
                                                                             AS sum_position,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL)
                                                                             AS count_position
  FROM responses
  WHERE pmm_use_case IS NOT NULL
  GROUP BY run_day, platform, COALESCE(prompt_type, '__none__'),
           pmm_use_case, COALESCE(pmm_classification, '__none__');

  -- ── 4. Domain citations ────────────────────────────────────
  INSERT INTO aeo_cache_domains (
    run_day, platform, prompt_type, domain, citation_type, response_count
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')                           AS prompt_type,
    LOWER(cd.domain)                                              AS domain,
    mode() WITHIN GROUP (ORDER BY cd.citation_type)               AS citation_type,
    COUNT(DISTINCT r.id)                                          AS response_count
  FROM citation_domains cd
  JOIN responses r ON r.id = cd.response_id
  WHERE cd.domain IS NOT NULL
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), LOWER(cd.domain);

  -- ── 5. Domain URLs ─────────────────────────────────────────
  INSERT INTO aeo_cache_domain_urls (
    run_day, platform, prompt_type, domain, url, title, url_count
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')   AS prompt_type,
    LOWER(cd.domain)                      AS domain,
    cd.url,
    MAX(cd.title)                         AS title,
    COUNT(*)                              AS url_count
  FROM citation_domains cd
  JOIN responses r ON r.id = cd.response_id
  WHERE cd.domain IS NOT NULL AND cd.url IS NOT NULL
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'),
           LOWER(cd.domain), cd.url;

  -- ── 6. Topic visibility ────────────────────────────────────
  INSERT INTO aeo_cache_topics (
    run_day, platform, prompt_type, topic, total_responses, clay_mentioned
  )
  SELECT
    run_day,
    platform,
    COALESCE(prompt_type, '__none__')     AS prompt_type,
    COALESCE(topic, 'Unknown')            AS topic,
    COUNT(*)                              AS total_responses,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes') AS clay_mentioned
  FROM responses
  GROUP BY run_day, platform, COALESCE(prompt_type, '__none__'), COALESCE(topic, 'Unknown');

  RAISE NOTICE 'Dashboard cache refreshed at %', NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_cache() TO anon, authenticated;


-- ============================================================
-- Macro: cache filter WHERE fragment (used inline in each RPC)
-- ============================================================
--   AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
--   AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
-- ============================================================


-- ── RPC 1: Visibility KPIs (cache-aware) ─────────────────────

CREATE OR REPLACE FUNCTION get_visibility_kpis(
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
  vis_current        FLOAT,
  vis_previous       FLOAT,
  vis_total          BIGINT,
  pos_current        FLOAT,
  pos_previous       FLOAT,
  claygent_current   BIGINT,
  claygent_previous  BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
DECLARE
  v_cur_total     BIGINT; v_cur_clay      BIGINT;
  v_cur_pos       FLOAT;  v_cur_claygent  BIGINT;
  v_prev_total    BIGINT; v_prev_clay     BIGINT;
  v_prev_pos      FLOAT;  v_prev_claygent BIGINT;
  v_prompt_count  BIGINT;
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path: cache ──────────────────────────────────────
    SELECT
      COALESCE(SUM(total_responses), 0),
      COALESCE(SUM(clay_mentioned),  0),
      CASE WHEN SUM(count_position) > 0 THEN SUM(sum_position) / SUM(count_position) END,
      COALESCE(SUM(claygent_mentioned), 0)
    INTO v_cur_total, v_cur_clay, v_cur_pos, v_cur_claygent
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type);

    SELECT
      COALESCE(SUM(total_responses), 0),
      COALESCE(SUM(clay_mentioned),  0),
      CASE WHEN SUM(count_position) > 0 THEN SUM(sum_position) / SUM(count_position) END,
      COALESCE(SUM(claygent_mentioned), 0)
    INTO v_prev_total, v_prev_clay, v_prev_pos, v_prev_claygent
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type);

  ELSE
    -- ── Slow path: live query ─────────────────────────────────
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'),
      AVG(clay_mention_position::float)
        FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL),
      COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
    INTO v_cur_total, v_cur_clay, v_cur_pos, v_cur_claygent
    FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    );

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'),
      AVG(clay_mention_position::float)
        FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL),
      COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
    INTO v_prev_total, v_prev_clay, v_prev_pos, v_prev_claygent
    FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_prev_start_day, p_prev_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    );
  END IF;

  SELECT COUNT(*) INTO v_prompt_count
  FROM prompts
  WHERE is_active = true
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_tags = 'all' OR tags = p_tags);

  RETURN QUERY SELECT
    CASE WHEN v_cur_total  > 0 THEN v_cur_clay::float  / v_cur_total  * 100 ELSE NULL END,
    CASE WHEN v_prev_total > 0 THEN v_prev_clay::float / v_prev_total * 100 ELSE NULL END,
    v_prompt_count,
    v_cur_pos,
    v_prev_pos,
    v_cur_claygent,
    v_prev_claygent;
END;
$$;

GRANT EXECUTE ON FUNCTION get_visibility_kpis(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 2: Citation share KPI (cache-aware) ──────────────────

CREATE OR REPLACE FUNCTION get_citation_share_kpi(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prev_start_day DATE,
  p_prev_end_day   DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(current_pct FLOAT, previous_pct FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
DECLARE
  v_cur_cited  BIGINT; v_cur_clay  BIGINT;
  v_prev_cited BIGINT; v_prev_clay BIGINT;
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path ─────────────────────────────────────────────
    SELECT
      COALESCE(SUM(total_with_citations), 0),
      COALESCE(SUM(clay_cited_responses), 0)
    INTO v_cur_cited, v_cur_clay
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type);

    SELECT
      COALESCE(SUM(total_with_citations), 0),
      COALESCE(SUM(clay_cited_responses), 0)
    INTO v_prev_cited, v_prev_clay
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type);

    RETURN QUERY SELECT
      CASE WHEN v_cur_cited  > 0 THEN v_cur_clay::float  / v_cur_cited  * 100 ELSE NULL END,
      CASE WHEN v_prev_cited > 0 THEN v_prev_clay::float / v_prev_cited * 100 ELSE NULL END;

  ELSE
    -- ── Slow path ─────────────────────────────────────────────
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
        (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
        (cited_domains IS NOT NULL AND jsonb_array_length(cited_domains) > 0) AS has_citation,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN p_prev_start_day AND p_prev_end_day)
    ),
    agg AS (
      SELECT
        COUNT(*) FILTER (WHERE is_cur  AND has_citation)              AS cur_n,
        COUNT(*) FILTER (WHERE is_cur  AND has_citation AND has_clay) AS cur_c,
        COUNT(*) FILTER (WHERE is_prev AND has_citation)              AS prev_n,
        COUNT(*) FILTER (WHERE is_prev AND has_citation AND has_clay) AS prev_c
      FROM filtered
    )
    SELECT
      CASE WHEN cur_n  > 0 THEN cur_c::float  / cur_n  * 100 ELSE NULL END,
      CASE WHEN prev_n > 0 THEN prev_c::float / prev_n * 100 ELSE NULL END
    FROM agg;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_citation_share_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 3: Competitor leaderboard (cache-aware) ───────────────

CREATE OR REPLACE FUNCTION get_competitor_leaderboard_rpc(
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
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path ─────────────────────────────────────────────
    RETURN QUERY
    WITH totals AS (
      SELECT
        SUM(total_responses) FILTER (WHERE run_day BETWEEN p_start_day AND p_end_day)      AS cur_n,
        SUM(total_responses) FILTER (WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS prev_n
      FROM aeo_cache_daily
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    ),
    comp AS (
      SELECT
        competitor_name,
        SUM(mention_count) FILTER (WHERE run_day BETWEEN p_start_day AND p_end_day)           AS cur_cnt,
        SUM(mention_count) FILTER (WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day)  AS prev_cnt
      FROM aeo_cache_competitors
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY competitor_name
    )
    SELECT
      c.competitor_name,
      c.cur_cnt                                                                          AS mention_count,
      CASE WHEN t.cur_n > 0 THEN c.cur_cnt::float / t.cur_n * 100 ELSE 0 END           AS visibility_score,
      CASE WHEN t.cur_n > 0 AND t.prev_n > 0 AND c.prev_cnt > 0
        THEN c.cur_cnt::float / t.cur_n * 100 - c.prev_cnt::float / t.prev_n * 100
        ELSE NULL END                                                                    AS delta
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
        (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
        (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN p_prev_start_day AND p_prev_end_day)
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
      CASE WHEN t.cur_n > 0 AND t.prev_n > 0 AND c.prev_cnt > 0
        THEN c.cur_cnt::float / t.cur_n * 100 - c.prev_cnt::float / t.prev_n * 100
        ELSE NULL END
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


-- ── RPC 4: Visibility timeseries (cache-aware) ────────────────

CREATE OR REPLACE FUNCTION get_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      run_day,
      SUM(clay_mentioned)::float / NULLIF(SUM(total_responses), 0) * 100
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day
    ORDER BY run_day;
  ELSE
    RETURN QUERY
    SELECT
      run_day,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
        / NULLIF(COUNT(*), 0) * 100
    FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
    GROUP BY run_day
    ORDER BY run_day;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 5: Competitor visibility timeseries (cache-aware) ─────

CREATE OR REPLACE FUNCTION get_competitor_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, competitor TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH totals AS (
      SELECT run_day, SUM(total_responses) AS n
      FROM aeo_cache_daily
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY run_day
    ),
    top_comp AS (
      SELECT competitor_name
      FROM aeo_cache_competitors
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY competitor_name
      ORDER BY SUM(mention_count) DESC
      LIMIT 20
    ),
    comp_daily AS (
      SELECT run_day, competitor_name, SUM(mention_count) AS cnt
      FROM aeo_cache_competitors
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND competitor_name IN (SELECT competitor_name FROM top_comp)
      GROUP BY run_day, competitor_name
    )
    SELECT cd.run_day, cd.competitor_name, cd.cnt::float / t.n * 100
    FROM comp_daily cd
    JOIN totals t USING (run_day)
    ORDER BY cd.run_day, cd.competitor_name;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id, run_day FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    totals AS (SELECT run_day, COUNT(*) AS n FROM filtered GROUP BY run_day),
    top_competitors AS (
      SELECT rc.competitor_name
      FROM response_competitors rc
      JOIN filtered f ON f.id = rc.response_id
      GROUP BY rc.competitor_name
      ORDER BY COUNT(*) DESC
      LIMIT 20
    ),
    comp_counts AS (
      SELECT f.run_day, rc.competitor_name, COUNT(rc.response_id) AS cnt
      FROM response_competitors rc
      JOIN filtered f ON f.id = rc.response_id
      WHERE rc.competitor_name IN (SELECT competitor_name FROM top_competitors)
      GROUP BY f.run_day, rc.competitor_name
    )
    SELECT cc.run_day, cc.competitor_name, cc.cnt::float / t.n * 100
    FROM comp_counts cc
    JOIN totals t USING (run_day)
    ORDER BY cc.run_day, cc.competitor_name;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 6: Citation timeseries (cache-aware) ──────────────────

CREATE OR REPLACE FUNCTION get_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      run_day,
      CASE
        WHEN SUM(total_with_citations) > 0
        THEN SUM(clay_cited_responses)::float / SUM(total_with_citations) * 100
        ELSE 0::float
      END
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day
    ORDER BY run_day;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        run_day,
        (cited_domains IS NOT NULL AND jsonb_array_length(cited_domains) > 0) AS has_citation,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    )
    SELECT
      run_day,
      CASE
        WHEN COUNT(*) FILTER (WHERE has_citation) > 0
        THEN COUNT(*) FILTER (WHERE has_citation AND has_clay)::float
             / COUNT(*) FILTER (WHERE has_citation) * 100
        ELSE 0
      END
    FROM filtered
    GROUP BY run_day
    ORDER BY run_day;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 7: Citation count KPI (cache-aware) ───────────────────

CREATE OR REPLACE FUNCTION get_citation_count_kpi(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prev_start_day DATE,
  p_prev_end_day   DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(current_count BIGINT, previous_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      COALESCE(SUM(clay_cited_responses) FILTER (WHERE run_day BETWEEN p_start_day AND p_end_day), 0),
      COALESCE(SUM(clay_cited_responses) FILTER (WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day), 0)
    FROM aeo_cache_daily
    WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                      AND GREATEST(p_end_day, p_prev_end_day)
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type);
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
        (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN p_prev_start_day AND p_prev_end_day)
    )
    SELECT
      COUNT(*) FILTER (WHERE is_cur  AND has_clay),
      COUNT(*) FILTER (WHERE is_prev AND has_clay)
    FROM filtered;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_citation_count_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 8: Clay KPIs (cache-aware) ───────────────────────────

CREATE OR REPLACE FUNCTION get_clay_kpis_rpc(
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
  visibility_current  FLOAT,
  visibility_previous FLOAT,
  citation_rate_cur   FLOAT,
  citation_rate_prev  FLOAT,
  avg_position        FLOAT,
  mention_count       BIGINT,
  top_topic           TEXT,
  top_platform        TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH cur AS (
      SELECT
        SUM(total_responses)      AS total,
        SUM(clay_mentioned)       AS mentioned,
        SUM(total_with_citations) AS cited_n,
        SUM(clay_cited_responses) AS clay_cited,
        CASE WHEN SUM(count_position) > 0 THEN SUM(sum_position)/SUM(count_position) END AS avg_pos
      FROM aeo_cache_daily
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    ),
    prev AS (
      SELECT
        SUM(total_responses)      AS total,
        SUM(clay_mentioned)       AS mentioned,
        SUM(total_with_citations) AS cited_n,
        SUM(clay_cited_responses) AS clay_cited
      FROM aeo_cache_daily
      WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    ),
    top_topic AS (
      SELECT topic
      FROM aeo_cache_topics
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY topic
      ORDER BY SUM(clay_mentioned) DESC
      LIMIT 1
    ),
    top_platform AS (
      SELECT platform
      FROM aeo_cache_daily
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY platform
      ORDER BY SUM(clay_mentioned) DESC
      LIMIT 1
    )
    SELECT
      CASE WHEN c.total       > 0 THEN c.mentioned::float  / c.total       * 100 ELSE NULL END,
      CASE WHEN p.total       > 0 THEN p.mentioned::float  / p.total       * 100 ELSE NULL END,
      CASE WHEN c.cited_n     > 0 THEN c.clay_cited::float / c.cited_n     * 100 ELSE NULL END,
      CASE WHEN p.cited_n     > 0 THEN p.clay_cited::float / p.cited_n     * 100 ELSE NULL END,
      c.avg_pos,
      c.mentioned,
      tt.topic,
      tp.platform
    FROM cur c
    CROSS JOIN prev p
    LEFT JOIN top_topic    tt ON true
    LEFT JOIN top_platform tp ON true;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
        (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
        clay_mentioned,
        clay_mention_position::float,
        topic,
        platform,
        (cited_domains IS NOT NULL AND jsonb_array_length(cited_domains) > 0) AS has_citation,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN p_prev_start_day AND p_prev_end_day)
    ),
    agg AS (
      SELECT
        COUNT(*) FILTER (WHERE is_cur)                                               AS cur_n,
        COUNT(*) FILTER (WHERE is_cur  AND clay_mentioned ILIKE 'yes')              AS cur_mentioned,
        COUNT(*) FILTER (WHERE is_prev)                                              AS prev_n,
        COUNT(*) FILTER (WHERE is_prev AND clay_mentioned ILIKE 'yes')              AS prev_mentioned,
        COUNT(*) FILTER (WHERE is_cur  AND has_citation)                            AS cur_cited_n,
        COUNT(*) FILTER (WHERE is_cur  AND has_citation AND has_clay)               AS cur_clay_cited,
        COUNT(*) FILTER (WHERE is_prev AND has_citation)                            AS prev_cited_n,
        COUNT(*) FILTER (WHERE is_prev AND has_citation AND has_clay)               AS prev_clay_cited,
        AVG(clay_mention_position)
          FILTER (WHERE is_cur AND clay_mentioned ILIKE 'yes'
                  AND clay_mention_position IS NOT NULL)                            AS avg_pos
      FROM filtered
    ),
    top_topic    AS (SELECT topic    FROM filtered WHERE is_cur AND clay_mentioned ILIKE 'yes' AND topic    IS NOT NULL GROUP BY topic    ORDER BY COUNT(*) DESC LIMIT 1),
    top_platform AS (SELECT platform FROM filtered WHERE is_cur AND clay_mentioned ILIKE 'yes' AND platform IS NOT NULL GROUP BY platform ORDER BY COUNT(*) DESC LIMIT 1)
    SELECT
      CASE WHEN a.cur_n        > 0 THEN a.cur_mentioned::float   / a.cur_n        * 100 ELSE NULL END,
      CASE WHEN a.prev_n       > 0 THEN a.prev_mentioned::float  / a.prev_n       * 100 ELSE NULL END,
      CASE WHEN a.cur_cited_n  > 0 THEN a.cur_clay_cited::float  / a.cur_cited_n  * 100 ELSE NULL END,
      CASE WHEN a.prev_cited_n > 0 THEN a.prev_clay_cited::float / a.prev_cited_n * 100 ELSE NULL END,
      a.avg_pos,
      a.cur_mentioned,
      tt.topic,
      tp.platform
    FROM agg a
    LEFT JOIN top_topic   tt ON true
    LEFT JOIN top_platform tp ON true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_clay_kpis_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 9: PMM table (cache-aware) ───────────────────────────

CREATE OR REPLACE FUNCTION get_pmm_table_rpc(
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
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH cur AS (
      SELECT
        pmm_use_case,
        pmm_classification,
        SUM(total_responses)  AS total,
        SUM(clay_mentioned)   AS mentioned,
        SUM(clay_cited)       AS clay_cited,
        CASE WHEN SUM(count_position) > 0 THEN SUM(sum_position)/SUM(count_position) END AS avg_pos
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
      WHERE run_day BETWEEN p_prev_start_day AND p_prev_end_day
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
            'value', CASE WHEN day_total > 0 THEN day_mentioned::float / day_total * 100 ELSE 0 END
          ) ORDER BY run_day
        ) AS timeseries
      FROM ts_daily
      GROUP BY pmm_use_case, pmm_classification
    )
    SELECT
      c.pmm_use_case,
      c.pmm_classification,
      CASE WHEN c.total > 0 THEN c.mentioned::float / c.total * 100 ELSE 0 END       AS visibility_score,
      CASE
        WHEN c.total > 0 AND p.total > 0
        THEN c.mentioned::float / c.total * 100 - p.mentioned::float / p.total * 100
        ELSE NULL
      END                                                                              AS delta,
      CASE WHEN c.total > 0 THEN c.clay_cited::float / c.total * 100 ELSE NULL END   AS citation_share,
      c.avg_pos,
      c.total,
      COALESCE(t.timeseries, '[]'::jsonb)
    FROM cur c
    LEFT JOIN prev    p USING (pmm_use_case, pmm_classification)
    LEFT JOIN ts_agg  t USING (pmm_use_case, pmm_classification)
    ORDER BY c.pmm_use_case, visibility_score DESC;

  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
        (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
        run_day, pmm_use_case, pmm_classification,
        clay_mentioned,
        clay_mention_position::float,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses
      WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                        AND GREATEST(p_end_day, p_prev_end_day)
        AND pmm_use_case IS NOT NULL
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
        AND (run_day BETWEEN p_start_day AND p_end_day
             OR run_day BETWEEN p_prev_start_day AND p_prev_end_day)
    ),
    cur_by_pmm AS (
      SELECT pmm_use_case, pmm_classification,
        COUNT(*) AS total, COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes') AS mentioned,
        COUNT(*) FILTER (WHERE has_clay) AS clay_cited,
        AVG(clay_mention_position) FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL) AS avg_pos
      FROM filtered WHERE is_cur GROUP BY pmm_use_case, pmm_classification
    ),
    prev_by_pmm AS (
      SELECT pmm_use_case, pmm_classification,
        COUNT(*) AS total, COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes') AS mentioned
      FROM filtered WHERE is_prev GROUP BY pmm_use_case, pmm_classification
    ),
    ts_by_day AS (
      SELECT pmm_use_case, pmm_classification, run_day,
        COUNT(*) AS total, COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes') AS mentioned
      FROM filtered WHERE is_cur GROUP BY pmm_use_case, pmm_classification, run_day
    ),
    ts_agg AS (
      SELECT pmm_use_case, pmm_classification,
        jsonb_agg(jsonb_build_object('date', run_day::text, 'value',
          CASE WHEN total > 0 THEN mentioned::float / total * 100 ELSE 0 END
        ) ORDER BY run_day) AS timeseries
      FROM ts_by_day GROUP BY pmm_use_case, pmm_classification
    )
    SELECT
      c.pmm_use_case, c.pmm_classification,
      CASE WHEN c.total > 0 THEN c.mentioned::float / c.total * 100 ELSE 0 END,
      CASE WHEN c.total > 0 AND p.total > 0
        THEN c.mentioned::float / c.total * 100 - p.mentioned::float / p.total * 100
        ELSE NULL END,
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


-- ── RPC 10: Visibility by topic (cache-aware) ─────────────────

CREATE OR REPLACE FUNCTION get_visibility_by_topic_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, topic TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      run_day,
      t.topic,
      SUM(clay_mentioned)::float / NULLIF(SUM(total_responses), 0) * 100
    FROM aeo_cache_topics t
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day, t.topic
    ORDER BY run_day, t.topic;
  ELSE
    RETURN QUERY
    SELECT
      run_day,
      COALESCE(r.topic, 'Unknown'),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
        / NULLIF(COUNT(*), 0) * 100
    FROM responses r
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY run_day, r.topic
    ORDER BY run_day, r.topic;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_visibility_by_topic_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 11: Visibility by PMM classification (cache-aware) ────

CREATE OR REPLACE FUNCTION get_visibility_by_pmm_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, pmm_use_case TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      run_day,
      pmm_classification,                        -- aliased to pmm_use_case for JS compat
      SUM(clay_mentioned)::float / NULLIF(SUM(total_responses), 0) * 100
    FROM aeo_cache_pmm
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day, pmm_classification
    ORDER BY run_day, pmm_classification;
  ELSE
    RETURN QUERY
    SELECT
      run_day,
      pmm_classification,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
        / NULLIF(COUNT(*), 0) * 100
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND pmm_classification IS NOT NULL
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY run_day, pmm_classification
    ORDER BY run_day, pmm_classification;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_visibility_by_pmm_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 12: Claygent timeseries (cache-aware) ─────────────────

CREATE OR REPLACE FUNCTION get_claygent_timeseries_rpc(
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
    SELECT run_day, SUM(claygent_mentioned)
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day
    ORDER BY run_day;
  ELSE
    RETURN QUERY
    SELECT
      run_day,
      COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY run_day
    ORDER BY run_day;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 13: Claygent by platform (cache-aware) ────────────────

CREATE OR REPLACE FUNCTION get_claygent_platform_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, platform TEXT, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT run_day, d.platform, SUM(claygent_mentioned)
    FROM aeo_cache_daily d
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day, d.platform
    ORDER BY run_day, d.platform;
  ELSE
    RETURN QUERY
    SELECT
      run_day,
      r.platform,
      COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
    FROM responses r
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY run_day, r.platform
    ORDER BY run_day, r.platform;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claygent_platform_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 14: Share of voice (cache-aware) ──────────────────────

CREATE OR REPLACE FUNCTION get_share_of_voice_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(competitor_name TEXT, mention_count BIGINT, sov_pct FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH rc_counts AS (
      SELECT competitor_name, SUM(mention_count) AS cnt
      FROM aeo_cache_competitors
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND competitor_name IS NOT NULL
      GROUP BY competitor_name
    ),
    total AS (SELECT SUM(cnt)::float AS n FROM rc_counts)
    SELECT
      rc.competitor_name,
      rc.cnt,
      CASE WHEN t.n > 0 THEN rc.cnt::float / t.n * 100 ELSE 0 END
    FROM rc_counts rc
    CROSS JOIN total t
    ORDER BY rc.cnt DESC
    LIMIT 50;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    rc_counts AS (
      SELECT rc.competitor_name, COUNT(*) AS cnt
      FROM response_competitors rc
      JOIN filtered f ON f.id = rc.response_id
      WHERE rc.competitor_name IS NOT NULL
      GROUP BY rc.competitor_name
    ),
    total AS (SELECT SUM(cnt)::float AS n FROM rc_counts)
    SELECT rc.competitor_name, rc.cnt,
      CASE WHEN t.n > 0 THEN rc.cnt::float / t.n * 100 ELSE 0 END
    FROM rc_counts rc
    CROSS JOIN total t
    ORDER BY rc.cnt DESC
    LIMIT 50;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_share_of_voice_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 15: Sentiment breakdown (cache-aware) ─────────────────

CREATE OR REPLACE FUNCTION get_sentiment_breakdown_rpc(
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
      COALESCE(SUM(total_responses),    0),
      COALESCE(SUM(clay_mentioned),     0),
      COALESCE(SUM(positive_sentiment), 0),
      COALESCE(SUM(neutral_sentiment),  0),
      COALESCE(SUM(negative_sentiment), 0),
      CASE WHEN SUM(count_sentiment_score) > 0
        THEN SUM(sum_sentiment_score) / SUM(count_sentiment_score) END
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type);
  ELSE
    RETURN QUERY
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Positive'),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Neutral'),
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Negative'),
      AVG(brand_sentiment_score::float)
        FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment_score IS NOT NULL)
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_breakdown_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 16: Sentiment timeseries (cache-aware) ────────────────

CREATE OR REPLACE FUNCTION get_sentiment_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, positive FLOAT, neutral FLOAT, negative FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      run_day,
      SUM(positive_sentiment)::float / NULLIF(SUM(clay_mentioned), 0) * 100,
      SUM(neutral_sentiment)::float  / NULLIF(SUM(clay_mentioned), 0) * 100,
      SUM(negative_sentiment)::float / NULLIF(SUM(clay_mentioned), 0) * 100
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY run_day
    ORDER BY run_day;
  ELSE
    RETURN QUERY
    SELECT
      run_day,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Positive')::float
        / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Neutral')::float
        / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Negative')::float
        / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY run_day
    ORDER BY run_day;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 18: Competitor citation timeseries (cache-aware) ──────

CREATE OR REPLACE FUNCTION get_competitor_citation_timeseries_rpc(
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
      SELECT run_day, SUM(response_count) AS total_cited
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY run_day
    ),
    top_competitors AS (
      SELECT domain
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND citation_type = 'Competition'
        AND domain NOT LIKE '%clay%'
      GROUP BY domain
      ORDER BY SUM(response_count) DESC
      LIMIT p_top_n
    ),
    relevant AS (
      SELECT domain FROM top_competitors
      UNION SELECT 'clay.com'
    ),
    domain_day AS (
      SELECT run_day, domain, SUM(response_count) AS cnt
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND domain IN (SELECT domain FROM relevant)
      GROUP BY run_day, domain
    )
    SELECT dd.run_day, dd.domain,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd
    JOIN daily_totals dt USING (run_day)
    ORDER BY dd.run_day, dd.domain;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id, run_day FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    cited AS (
      SELECT f.run_day, f.id AS response_id,
        CASE WHEN LOWER(cd.domain) LIKE '%clay.com%' THEN 'clay.com' ELSE LOWER(cd.domain) END AS domain,
        cd.citation_type
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    daily_totals AS (
      SELECT run_day, COUNT(DISTINCT response_id) AS total_cited FROM cited GROUP BY run_day
    ),
    top_competitors AS (
      SELECT domain FROM cited
      WHERE citation_type = 'Competition' AND domain NOT LIKE '%clay%'
      GROUP BY domain ORDER BY COUNT(DISTINCT response_id) DESC LIMIT p_top_n
    ),
    domain_day AS (
      SELECT run_day, domain, COUNT(DISTINCT response_id) AS cnt FROM cited
      WHERE domain IN (SELECT domain FROM top_competitors UNION SELECT 'clay.com')
      GROUP BY run_day, domain
    )
    SELECT dd.run_day, dd.domain,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd JOIN daily_totals dt USING (run_day)
    ORDER BY dd.run_day, dd.domain;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT)
  TO anon, authenticated;


-- ── RPC 19: Top cited domains with URLs (cache-aware) ─────────

CREATE OR REPLACE FUNCTION get_top_cited_domains_rpc(
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
      SELECT
        domain,
        SUM(response_count)                                     AS response_count,
        mode() WITHIN GROUP (ORDER BY citation_type)            AS citation_type,
        BOOL_OR(domain LIKE '%clay.com%')                       AS is_clay
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY domain
      ORDER BY SUM(response_count) DESC
      LIMIT 20
    ),
    total_cited AS (SELECT SUM(response_count)::float AS n FROM domain_agg),
    url_agg AS (
      SELECT
        domain,
        url,
        MAX(title) AS title,
        SUM(url_count) AS cnt,
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
        jsonb_agg(jsonb_build_object('url', url, 'title', title, 'count', cnt) ORDER BY cnt DESC) AS top_urls
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
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    citations AS (
      SELECT LOWER(cd.domain) AS domain, cd.url, cd.title, cd.citation_type, cd.response_id
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    total_cited AS (SELECT COUNT(DISTINCT response_id)::float AS n FROM citations),
    domain_stats AS (
      SELECT domain,
        COUNT(DISTINCT response_id)                        AS response_count,
        BOOL_OR(domain LIKE '%clay.com%')                  AS is_clay,
        mode() WITHIN GROUP (ORDER BY citation_type)       AS citation_type
      FROM citations GROUP BY domain
    ),
    url_ranked AS (
      SELECT domain, url, MAX(title) AS title, COUNT(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY domain ORDER BY COUNT(*) DESC) AS rn
      FROM citations WHERE url IS NOT NULL GROUP BY domain, url
    ),
    top_urls AS (
      SELECT domain,
        jsonb_agg(jsonb_build_object('url', url, 'title', title, 'count', cnt) ORDER BY cnt DESC) AS top_urls
      FROM url_ranked WHERE rn <= 8 GROUP BY domain
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
