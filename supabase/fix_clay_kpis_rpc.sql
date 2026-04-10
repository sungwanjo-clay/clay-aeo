-- ============================================================
-- Fix: get_clay_kpis_rpc type mismatch (mention_count)
-- ============================================================
-- Problem:
--   SUM(bigint) returns NUMERIC in PostgreSQL, but the function's
--   RETURNS TABLE declares mention_count BIGINT. This causes a
--   "structure of query does not match function result type" error
--   (HTTP 400 from PostgREST) on every call.
--
-- Fix: add ::bigint casts to the two mention_count return columns
--   (one in the fast path, one in the slow path).
-- ============================================================

DROP FUNCTION IF EXISTS get_clay_kpis_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_clay_kpis_rpc(
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
      CASE WHEN c.total   > 0 THEN c.mentioned::float  / c.total   * 100 ELSE NULL END,
      CASE WHEN p.total   > 0 THEN p.mentioned::float  / p.total   * 100 ELSE NULL END,
      CASE WHEN c.cited_n > 0 THEN c.clay_cited::float / c.cited_n * 100 ELSE NULL END,
      CASE WHEN p.cited_n > 0 THEN p.clay_cited::float / p.cited_n * 100 ELSE NULL END,
      c.avg_pos,
      c.mentioned::bigint,   -- SUM(bigint) → numeric in PG; cast back to bigint
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
        COUNT(*) FILTER (WHERE is_cur)                                          AS cur_n,
        COUNT(*) FILTER (WHERE is_cur  AND clay_mentioned ILIKE 'yes')         AS cur_mentioned,
        COUNT(*) FILTER (WHERE is_prev)                                         AS prev_n,
        COUNT(*) FILTER (WHERE is_prev AND clay_mentioned ILIKE 'yes')         AS prev_mentioned,
        COUNT(*) FILTER (WHERE is_cur  AND has_citation)                       AS cur_cited_n,
        COUNT(*) FILTER (WHERE is_cur  AND has_citation AND has_clay)          AS cur_clay_cited,
        COUNT(*) FILTER (WHERE is_prev AND has_citation)                       AS prev_cited_n,
        COUNT(*) FILTER (WHERE is_prev AND has_citation AND has_clay)          AS prev_clay_cited,
        AVG(clay_mention_position)
          FILTER (WHERE is_cur AND clay_mentioned ILIKE 'yes'
                  AND clay_mention_position IS NOT NULL)                       AS avg_pos
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
      a.cur_mentioned::bigint,   -- COUNT(*) FILTER returns bigint, cast explicit for clarity
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
