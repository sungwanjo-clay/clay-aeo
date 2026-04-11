-- ============================================================
-- Speed up Sentiment tab
-- ============================================================
-- Problem: getSentimentNarratives + getCompetitivePositioningEntries
-- both do full `responses` table scans, downloading themes +
-- positioning_vs_competitors JSONB for every row — thousands of
-- rows × large JSONB blobs = very slow.
--
-- Fix:
--   1. Add aeo_cache_narratives pre-aggregated table:
--      (theme, sentiment, run_day, platform, prompt_type) → occurrence_count + snippets[]
--   2. Add aeo_cache_positioning pre-aggregated table:
--      positioning_vs_competitors snippets with metadata
--   3. Extend refresh_dashboard_cache() to populate both tables
--   4. Add RPC get_sentiment_narratives_rpc() that reads from cache
--   5. Add RPC get_competitive_positioning_rpc() that reads from cache
-- ============================================================


-- ── Step 1: aeo_cache_narratives ─────────────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_narratives (
  id              BIGSERIAL PRIMARY KEY,
  run_day         DATE        NOT NULL,
  platform        TEXT        NOT NULL,
  prompt_type     TEXT        NOT NULL DEFAULT '__none__',
  theme           TEXT        NOT NULL,
  sentiment       TEXT        NOT NULL,  -- 'Positive' | 'Neutral' | 'Negative'
  occurrence_count BIGINT     NOT NULL DEFAULT 0,
  -- Up to 10 recent snippets stored as JSONB array of {text, topic, date}
  snippets        JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aeo_cache_narratives_key
  ON aeo_cache_narratives (run_day, platform, prompt_type, theme, sentiment);

CREATE INDEX IF NOT EXISTS idx_aeo_cache_narratives_day
  ON aeo_cache_narratives (run_day, platform, prompt_type);


-- ── Step 2: aeo_cache_positioning ────────────────────────────

CREATE TABLE IF NOT EXISTS aeo_cache_positioning (
  id          BIGSERIAL PRIMARY KEY,
  run_day     DATE    NOT NULL,
  platform    TEXT    NOT NULL,
  prompt_type TEXT    NOT NULL DEFAULT '__none__',
  topic       TEXT    NOT NULL DEFAULT '',
  snippet     TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aeo_cache_positioning_day
  ON aeo_cache_positioning (run_day, platform, prompt_type);


-- ── Step 3: Extend refresh_dashboard_cache() ─────────────────

CREATE OR REPLACE FUNCTION refresh_dashboard_cache()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300000'
AS $$
DECLARE
  v_rows INT;
BEGIN

  -- ── aeo_cache_daily ─────────────────────────────────────────
  WITH citation_flags AS (
    SELECT
      response_id,
      TRUE                                        AS has_any,
      BOOL_OR(LOWER(domain) LIKE '%clay%')        AS has_clay
    FROM citation_domains
    WHERE response_id IS NOT NULL
    GROUP BY response_id
  )
  INSERT INTO aeo_cache_daily (
    run_day, platform, prompt_type,
    total_responses, clay_mentioned,
    total_with_citations, clay_cited,
    positive_sentiment, neutral_sentiment, negative_sentiment,
    sum_sentiment_score, count_sentiment_score
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')            AS prompt_type,
    COUNT(*)                                        AS total_responses,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes'),
    COUNT(*) FILTER (WHERE cf.has_any IS TRUE),
    COUNT(*) FILTER (WHERE cf.has_clay IS TRUE),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Positive'),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Neutral'),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Negative'),
    COALESCE(SUM(r.brand_sentiment_score) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL), 0),
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL)
  FROM responses r
  LEFT JOIN citation_flags cf ON cf.response_id = r.id
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__')
  ON CONFLICT (run_day, platform, prompt_type)
  DO UPDATE SET
    total_responses       = EXCLUDED.total_responses,
    clay_mentioned        = EXCLUDED.clay_mentioned,
    total_with_citations  = EXCLUDED.total_with_citations,
    clay_cited            = EXCLUDED.clay_cited,
    positive_sentiment    = EXCLUDED.positive_sentiment,
    neutral_sentiment     = EXCLUDED.neutral_sentiment,
    negative_sentiment    = EXCLUDED.negative_sentiment,
    sum_sentiment_score   = EXCLUDED.sum_sentiment_score,
    count_sentiment_score = EXCLUDED.count_sentiment_score;


  -- ── aeo_cache_competitors ────────────────────────────────────
  INSERT INTO aeo_cache_competitors (run_day, platform, prompt_type, competitor_name, mention_count)
  SELECT
    rc.run_date::date   AS run_day,
    rc.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    rc.competitor_name,
    COUNT(*)            AS mention_count
  FROM response_competitors rc
  JOIN responses r ON r.id = rc.response_id
  WHERE rc.competitor_name IS NOT NULL
  GROUP BY rc.run_date::date, rc.platform, COALESCE(r.prompt_type, '__none__'), rc.competitor_name
  ON CONFLICT (run_day, platform, prompt_type, competitor_name)
  DO UPDATE SET mention_count = EXCLUDED.mention_count;


  -- ── aeo_cache_domains ────────────────────────────────────────
  INSERT INTO aeo_cache_domains (run_day, platform, prompt_type, domain, citation_type, response_count)
  SELECT
    cd.run_date::date   AS run_day,
    cd.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    cd.domain,
    cd.citation_type,
    COUNT(DISTINCT cd.response_id) AS response_count
  FROM citation_domains cd
  JOIN responses r ON r.id = cd.response_id
  WHERE cd.domain IS NOT NULL
  GROUP BY cd.run_date::date, cd.platform, COALESCE(r.prompt_type, '__none__'), cd.domain, cd.citation_type
  ON CONFLICT (run_day, platform, prompt_type, domain, citation_type)
  DO UPDATE SET response_count = EXCLUDED.response_count;


  -- ── aeo_cache_topics ─────────────────────────────────────────
  INSERT INTO aeo_cache_topics (run_day, platform, prompt_type, topic, response_count, clay_mentioned, clay_cited)
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__') AS prompt_type,
    COALESCE(r.topic, '__none__')       AS topic,
    COUNT(*)                            AS response_count,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes') AS clay_mentioned,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = r.id AND LOWER(cd.domain) LIKE '%clay%'
    ))                                  AS clay_cited
  FROM responses r
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), COALESCE(r.topic, '__none__')
  ON CONFLICT (run_day, platform, prompt_type, topic)
  DO UPDATE SET
    response_count = EXCLUDED.response_count,
    clay_mentioned = EXCLUDED.clay_mentioned,
    clay_cited     = EXCLUDED.clay_cited;


  -- ── aeo_cache_narratives ─────────────────────────────────────
  -- Expand themes JSONB array, normalize sentiment, aggregate per (run_day, platform, prompt_type, theme, sentiment)
  TRUNCATE aeo_cache_narratives;

  INSERT INTO aeo_cache_narratives (run_day, platform, prompt_type, theme, sentiment, occurrence_count, snippets)
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
    -- Store up to 10 snippets as JSONB array
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'text',     t.snippet,
        'platform', r.platform,
        'topic',    COALESCE(r.topic, ''),
        'date',     r.run_day::text
      )
      ORDER BY r.run_day DESC
    ) FILTER (WHERE t.snippet IS NOT NULL AND t.snippet <> '')
    -- Limit to 10 snippets
  FROM responses r
  -- Expand the themes JSONB array into rows
  CROSS JOIN LATERAL jsonb_to_recordset(
    CASE
      WHEN r.themes IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(r.themes) = 'array' THEN r.themes
      ELSE '[]'::jsonb
    END
  ) AS t(theme TEXT, sentiment TEXT, snippet TEXT)
  WHERE r.clay_mentioned ILIKE 'yes'
    AND t.theme IS NOT NULL
    AND t.theme <> ''
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), t.theme,
    CASE
      WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'positive' THEN 'Positive'
      WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'negative' THEN 'Negative'
      ELSE 'Neutral'
    END
  ON CONFLICT (run_day, platform, prompt_type, theme, sentiment)
  DO UPDATE SET
    occurrence_count = EXCLUDED.occurrence_count,
    snippets         = EXCLUDED.snippets;


  -- ── aeo_cache_positioning ────────────────────────────────────
  TRUNCATE aeo_cache_positioning;

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
  RETURN 'Cache refreshed. Positioning rows: ' || v_rows;

END;
$$;


-- ── Step 4: RPC for narratives (reads from cache) ─────────────

DROP FUNCTION IF EXISTS get_sentiment_narratives_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE OR REPLACE FUNCTION get_sentiment_narratives_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  theme            TEXT,
  sentiment        TEXT,
  occurrence_count BIGINT,
  snippets         JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '15000'
AS $$
BEGIN
  -- Fast path: cache (no branded/tags filters in cache — fall through to slow path if needed)
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      n.theme,
      n.sentiment,
      SUM(n.occurrence_count)::bigint AS occurrence_count,
      -- Merge snippets from all matching rows, keep newest 10
      (
        SELECT JSONB_AGG(s ORDER BY (s->>'date') DESC)
        FROM (
          SELECT DISTINCT s
          FROM JSONB_ARRAY_ELEMENTS(
            COALESCE(JSONB_AGG(n2.snippets), '[]'::jsonb)
          ) AS s
          LIMIT 10
        ) sub
      ) AS snippets
    FROM aeo_cache_narratives n
    -- Silly self-join trick to get all snippets for aggregation
    JOIN aeo_cache_narratives n2
      ON n2.theme = n.theme AND n2.sentiment = n.sentiment
      AND n2.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR n2.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR n2.prompt_type ILIKE p_prompt_type)
    WHERE n.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR n.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR n.prompt_type ILIKE p_prompt_type)
    GROUP BY n.theme, n.sentiment
    ORDER BY
      CASE n.sentiment WHEN 'Negative' THEN 0 WHEN 'Neutral' THEN 1 ELSE 2 END,
      SUM(n.occurrence_count) DESC;
  ELSE
    -- Slow path: raw responses table (branded/tags filter not in cache)
    RETURN QUERY
    SELECT
      t.theme,
      CASE
        WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'positive' THEN 'Positive'
        WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'negative' THEN 'Negative'
        ELSE 'Neutral'
      END                              AS sentiment,
      COUNT(*)::bigint                 AS occurrence_count,
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
      CASE
        WHEN r.themes IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(r.themes) = 'array' THEN r.themes
        ELSE '[]'::jsonb
      END
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
      CASE WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'negative' THEN 0
           WHEN LOWER(COALESCE(t.sentiment, r.brand_sentiment, '')) = 'positive' THEN 2
           ELSE 1 END,
      COUNT(*) DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_narratives_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── Step 5: RPC for positioning (reads from cache) ────────────

DROP FUNCTION IF EXISTS get_competitive_positioning_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE OR REPLACE FUNCTION get_competitive_positioning_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  run_day     DATE,
  platform    TEXT,
  topic       TEXT,
  snippet     TEXT
)
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
    SELECT r.run_day, r.platform, COALESCE(r.topic, '')::text, r.positioning_vs_competitors::text
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

GRANT EXECUTE ON FUNCTION get_competitive_positioning_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── Step 6: Run the cache refresh ────────────────────────────
-- This will take ~30-60 seconds on first run

SELECT refresh_dashboard_cache();
