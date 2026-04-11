-- ============================================================
-- Patch: Fix missing columns + add sentiment cache tables
-- ============================================================
-- Run this instead of speed_up_sentiment_tab.sql.
-- It handles all the errors from that file in one clean shot.
-- ============================================================


-- ── Step 1: Add any missing columns to existing cache tables ─

ALTER TABLE aeo_cache_daily
  ADD COLUMN IF NOT EXISTS clay_cited_responses  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_with_citations  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sum_position          FLOAT,
  ADD COLUMN IF NOT EXISTS count_position        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_sentiment    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS neutral_sentiment     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_sentiment    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sum_sentiment_score   FLOAT,
  ADD COLUMN IF NOT EXISTS count_sentiment_score BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claygent_mentioned    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clay_followup         BIGINT NOT NULL DEFAULT 0;

ALTER TABLE aeo_cache_topics
  ADD COLUMN IF NOT EXISTS clay_cited   BIGINT NOT NULL DEFAULT 0;

ALTER TABLE aeo_cache_domain_urls
  ADD COLUMN IF NOT EXISTS url_type TEXT;


-- ── Step 2: New narrative cache table ────────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_narratives (
  id               BIGSERIAL PRIMARY KEY,
  run_day          DATE   NOT NULL,
  platform         TEXT   NOT NULL,
  prompt_type      TEXT   NOT NULL DEFAULT '__none__',
  theme            TEXT   NOT NULL,
  sentiment        TEXT   NOT NULL,
  occurrence_count BIGINT NOT NULL DEFAULT 0,
  snippets         JSONB  NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aeo_cache_narratives_key
  ON aeo_cache_narratives (run_day, platform, prompt_type, theme, sentiment);

CREATE INDEX IF NOT EXISTS idx_aeo_cache_narratives_day
  ON aeo_cache_narratives (run_day, platform, prompt_type);


-- ── Step 3: New positioning cache table ──────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_positioning (
  id          BIGSERIAL PRIMARY KEY,
  run_day     DATE NOT NULL,
  platform    TEXT NOT NULL,
  prompt_type TEXT NOT NULL DEFAULT '__none__',
  topic       TEXT NOT NULL DEFAULT '',
  snippet     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aeo_cache_positioning_day
  ON aeo_cache_positioning (run_day, platform, prompt_type);


-- ── Step 4: Drop + recreate refresh_dashboard_cache() ────────
-- Must DROP because the return type changed (void → TEXT)

DROP FUNCTION IF EXISTS refresh_dashboard_cache();

CREATE OR REPLACE FUNCTION refresh_dashboard_cache()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300000'
AS $$
DECLARE
  v_rows INT;
BEGIN

  -- Truncate all cache tables
  TRUNCATE
    aeo_cache_daily,
    aeo_cache_competitors,
    aeo_cache_pmm,
    aeo_cache_domains,
    aeo_cache_domain_urls,
    aeo_cache_topics,
    aeo_cache_narratives,
    aeo_cache_positioning;


  -- ── 1. Core daily metrics ──────────────────────────────────
  WITH citation_flags AS (
    SELECT
      response_id,
      TRUE                                     AS has_any,
      BOOL_OR(LOWER(domain) LIKE '%clay%')     AS has_clay
    FROM citation_domains
    WHERE response_id IS NOT NULL
    GROUP BY response_id
  )
  INSERT INTO aeo_cache_daily (
    run_day, platform, prompt_type,
    total_responses, clay_mentioned, claygent_mentioned, clay_followup,
    clay_cited_responses, total_with_citations,
    sum_position, count_position,
    positive_sentiment, neutral_sentiment, negative_sentiment,
    sum_sentiment_score, count_sentiment_score
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')         AS prompt_type,
    COUNT(*)                                    AS total_responses,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes'),
    COUNT(*) FILTER (WHERE r.claygent_or_mcp_mentioned ILIKE 'yes'),
    COUNT(*) FILTER (WHERE r.clay_recommended_followup ILIKE 'yes'),
    COUNT(*) FILTER (WHERE cf.has_clay IS TRUE),
    COUNT(*) FILTER (WHERE cf.has_any  IS TRUE),
    SUM(r.clay_mention_position::float)
      FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.clay_mention_position IS NOT NULL),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.clay_mention_position IS NOT NULL),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Positive'),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Neutral'),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Negative'),
    SUM(r.brand_sentiment_score::float)
      FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL)
  FROM responses r
  LEFT JOIN citation_flags cf ON cf.response_id = r.id
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__');


  -- ── 2. Competitor mentions ─────────────────────────────────
  INSERT INTO aeo_cache_competitors (
    run_day, platform, prompt_type, competitor_name, mention_count
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    rc.competitor_name,
    COUNT(*)                            AS mention_count
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
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = responses.id AND LOWER(cd.domain) LIKE '%clay%'
    ))                                                                       AS clay_cited,
    SUM(clay_mention_position::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL)
                                                                             AS sum_position,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL)
                                                                             AS count_position
  FROM responses
  WHERE pmm_use_case IS NOT NULL
  GROUP BY run_day, platform, COALESCE(prompt_type, '__none__'), pmm_use_case, COALESCE(pmm_classification, '__none__');


  -- ── 4. Domain citations ────────────────────────────────────
  -- NOTE: aeo_cache_domains PRIMARY KEY is (run_day, platform, prompt_type, domain)
  -- with NO citation_type — aggregate across all citation types per domain to avoid
  -- "ON CONFLICT cannot affect row a second time" when same domain has multiple types.
  INSERT INTO aeo_cache_domains (
    run_day, platform, prompt_type, domain, citation_type, response_count
  )
  SELECT
    cd.run_date::date                          AS run_day,
    cd.platform,
    COALESCE(r.prompt_type, '__none__')        AS prompt_type,
    cd.domain,
    MAX(cd.citation_type)                      AS citation_type,   -- most common type
    COUNT(DISTINCT cd.response_id)             AS response_count
  FROM citation_domains cd
  JOIN responses r ON r.id = cd.response_id
  WHERE cd.domain IS NOT NULL
  GROUP BY cd.run_date::date, cd.platform, COALESCE(r.prompt_type, '__none__'), cd.domain
  ON CONFLICT (run_day, platform, prompt_type, domain)
  DO UPDATE SET
    response_count = EXCLUDED.response_count,
    citation_type  = EXCLUDED.citation_type;


  -- ── 5. Domain URLs ─────────────────────────────────────────
  INSERT INTO aeo_cache_domain_urls (
    run_day, platform, prompt_type, domain, url, title, url_type, url_count
  )
  SELECT
    cd.run_date::date                   AS run_day,
    cd.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    cd.domain,
    cd.url,
    MAX(cd.title)                       AS title,
    MAX(cd.citation_type)               AS url_type,
    COUNT(*)                            AS url_count
  FROM citation_domains cd
  JOIN responses r ON r.id = cd.response_id
  WHERE cd.url IS NOT NULL AND cd.domain IS NOT NULL
  GROUP BY cd.run_date::date, cd.platform, COALESCE(r.prompt_type, '__none__'), cd.domain, cd.url;


  -- ── 6. Topic visibility ────────────────────────────────────
  INSERT INTO aeo_cache_topics (
    run_day, platform, prompt_type, topic, total_responses, clay_mentioned, clay_cited
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    COALESCE(r.topic, '__none__')       AS topic,
    COUNT(*)                            AS total_responses,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes') AS clay_mentioned,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = r.id AND LOWER(cd.domain) LIKE '%clay%'
    ))                                  AS clay_cited
  FROM responses r
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), COALESCE(r.topic, '__none__');


  -- ── 7. Narrative cache ─────────────────────────────────────
  INSERT INTO aeo_cache_narratives (
    run_day, platform, prompt_type, theme, sentiment, occurrence_count, snippets
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    t.theme,
    CASE
      WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'positive' THEN 'Positive'
      WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'negative' THEN 'Negative'
      ELSE 'Neutral'
    END                                 AS sentiment,
    COUNT(*)                            AS occurrence_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'text',     t.snippet,
        'platform', r.platform,
        'topic',    COALESCE(r.topic, ''),
        'date',     r.run_day::text
      ) ORDER BY r.run_day DESC
    ) FILTER (WHERE t.snippet IS NOT NULL AND t.snippet <> '')
  FROM responses r
  CROSS JOIN LATERAL jsonb_to_recordset(
    CASE
      WHEN r.themes IS NULL              THEN '[]'::jsonb
      WHEN jsonb_typeof(r.themes) = 'array' THEN r.themes
      ELSE '[]'::jsonb
    END
  ) AS t(theme TEXT, sentiment TEXT, snippet TEXT)
  WHERE r.clay_mentioned ILIKE 'yes'
    AND t.theme IS NOT NULL
    AND t.theme <> ''
  GROUP BY
    r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), t.theme,
    CASE
      WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'positive' THEN 'Positive'
      WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'negative' THEN 'Negative'
      ELSE 'Neutral'
    END;


  -- ── 8. Positioning cache ───────────────────────────────────
  INSERT INTO aeo_cache_positioning (run_day, platform, prompt_type, topic, snippet)
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    COALESCE(r.topic, '')               AS topic,
    r.positioning_vs_competitors        AS snippet
  FROM responses r
  WHERE r.clay_mentioned ILIKE 'yes'
    AND r.positioning_vs_competitors IS NOT NULL
    AND r.positioning_vs_competitors <> ''
  ORDER BY r.run_day DESC;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN 'Cache refreshed OK. Positioning rows inserted: ' || v_rows;

END;
$$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_cache() TO anon, authenticated;


-- ── Step 5: Narrative RPC ─────────────────────────────────────

DROP FUNCTION IF EXISTS get_sentiment_narratives_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE OR REPLACE FUNCTION get_sentiment_narratives_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT   DEFAULT 'all',
  p_platforms      TEXT[] DEFAULT '{}',
  p_branded_filter TEXT   DEFAULT 'all',
  p_tags           TEXT   DEFAULT 'all'
)
RETURNS TABLE(theme TEXT, sentiment TEXT, occurrence_count BIGINT, snippets JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '15000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      n.theme,
      n.sentiment,
      SUM(n.occurrence_count)::bigint,
      JSONB_AGG(s ORDER BY (s->>'date') DESC) FILTER (WHERE s IS NOT NULL) AS snippets
    FROM aeo_cache_narratives n
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(COALESCE(n.snippets, '[]'::jsonb)) AS s
    WHERE n.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR n.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR n.prompt_type ILIKE p_prompt_type)
    GROUP BY n.theme, n.sentiment
    ORDER BY
      CASE n.sentiment WHEN 'Negative' THEN 0 WHEN 'Neutral' THEN 1 ELSE 2 END,
      SUM(n.occurrence_count) DESC;
  ELSE
    -- Slow path for branded/tags filters (not in cache)
    RETURN QUERY
    SELECT
      t.theme,
      CASE
        WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'positive' THEN 'Positive'
        WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'negative' THEN 'Negative'
        ELSE 'Neutral'
      END::text                          AS sentiment,
      COUNT(*)::bigint                   AS occurrence_count,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'text',     t.snippet,
          'platform', r.platform,
          'topic',    COALESCE(r.topic, ''),
          'date',     r.run_day::text
        ) ORDER BY r.run_day DESC
      ) FILTER (WHERE t.snippet IS NOT NULL AND t.snippet <> '') AS snippets
    FROM responses r
    CROSS JOIN LATERAL jsonb_to_recordset(
      CASE WHEN r.themes IS NULL THEN '[]'::jsonb
           WHEN jsonb_typeof(r.themes) = 'array' THEN r.themes
           ELSE '[]'::jsonb END
    ) AS t(theme TEXT, sentiment TEXT, snippet TEXT)
    WHERE r.clay_mentioned ILIKE 'yes'
      AND r.run_day BETWEEN p_start_day AND p_end_day
      AND t.theme IS NOT NULL AND t.theme <> ''
      AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
      AND (array_length(p_platforms,1) IS NULL OR r.platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR r.tags = p_tags)
    GROUP BY t.theme, 2
    ORDER BY
      CASE WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment,''))='negative' THEN 0
           WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment,''))='positive' THEN 2
           ELSE 1 END,
      COUNT(*) DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_narratives_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT) TO anon, authenticated;


-- ── Step 6: Positioning RPC ───────────────────────────────────

DROP FUNCTION IF EXISTS get_competitive_positioning_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE OR REPLACE FUNCTION get_competitive_positioning_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT   DEFAULT 'all',
  p_platforms      TEXT[] DEFAULT '{}',
  p_branded_filter TEXT   DEFAULT 'all',
  p_tags           TEXT   DEFAULT 'all'
)
RETURNS TABLE(run_day DATE, platform TEXT, topic TEXT, snippet TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '15000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT p.run_day, p.platform, p.topic, p.snippet
    FROM aeo_cache_positioning p
    WHERE p.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR p.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR p.prompt_type ILIKE p_prompt_type)
    ORDER BY p.run_day DESC
    LIMIT 500;
  ELSE
    RETURN QUERY
    SELECT r.run_day, r.platform, COALESCE(r.topic,'')::text, r.positioning_vs_competitors::text
    FROM responses r
    WHERE r.clay_mentioned ILIKE 'yes'
      AND r.positioning_vs_competitors IS NOT NULL
      AND r.run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
      AND (array_length(p_platforms,1) IS NULL OR r.platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR r.tags = p_tags)
    ORDER BY r.run_day DESC
    LIMIT 500;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitive_positioning_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT) TO anon, authenticated;


-- ── Step 7: Run the cache (30–60 seconds) ────────────────────

SELECT refresh_dashboard_cache();
