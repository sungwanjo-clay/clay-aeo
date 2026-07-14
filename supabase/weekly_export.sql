-- ============================================================
-- Weekly AEO export
--
-- One row per (ISO week starting Monday) × platform × prompt_type
-- with the same metric family the responses table already tracks:
--   • visibility  (clay_mentioned, clay_recommended_followup, claygent_or_mcp_mentioned)
--   • position    (avg clay_mention_position when mentioned)
--   • sentiment   (brand_sentiment breakdown, brand_sentiment_score, sentiment_score)
--   • citations   (share of responses whose cited_domains array is non-empty)
--   • usage       (avg tools recommended, total credits, unique prompts, unique topics)
--
-- Usage:
--   SELECT * FROM get_weekly_export(CURRENT_DATE - INTERVAL '2 months', CURRENT_DATE);
-- ============================================================

CREATE OR REPLACE FUNCTION get_weekly_export(
  p_start_day DATE,
  p_end_day   DATE
)
RETURNS TABLE(
  week_start                                DATE,
  week_end                                  DATE,
  platform                                  TEXT,
  prompt_type                               TEXT,
  total_responses                           BIGINT,
  unique_prompts                            BIGINT,
  unique_topics                             BIGINT,
  clay_mentioned_yes                        BIGINT,
  clay_mention_rate_pct                     NUMERIC,
  avg_clay_mention_position_when_mentioned  NUMERIC,
  claygent_or_mcp_mentioned_yes             BIGINT,
  claygent_or_mcp_mention_rate_pct          NUMERIC,
  clay_recommended_followup_yes             BIGINT,
  clay_followup_rate_pct                    NUMERIC,
  responses_with_citations                  BIGINT,
  citation_coverage_pct                     NUMERIC,
  brand_sentiment_positive                  BIGINT,
  brand_sentiment_neutral                   BIGINT,
  brand_sentiment_negative                  BIGINT,
  brand_sentiment_not_mentioned             BIGINT,
  positive_rate_pct                         NUMERIC,
  negative_rate_pct                         NUMERIC,
  avg_brand_sentiment_score                 NUMERIC,
  avg_sentiment_score                       NUMERIC,
  avg_number_of_tools_recommended           NUMERIC,
  total_credits_charged                     NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '60000'
AS $$
  SELECT
    date_trunc('week', r.run_day)::date                                                   AS week_start,
    (date_trunc('week', r.run_day) + INTERVAL '6 days')::date                             AS week_end,
    r.platform,
    COALESCE(r.prompt_type, '')                                                           AS prompt_type,
    COUNT(*)                                                                              AS total_responses,
    COUNT(DISTINCT r.prompt_id)                                                           AS unique_prompts,
    COUNT(DISTINCT r.topic)                                                               AS unique_topics,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')                                  AS clay_mentioned_yes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')
          / NULLIF(COUNT(*), 0), 2)                                                       AS clay_mention_rate_pct,
    ROUND(AVG(r.clay_mention_position) FILTER (WHERE r.clay_mentioned ILIKE 'yes'), 3)    AS avg_clay_mention_position_when_mentioned,
    COUNT(*) FILTER (WHERE r.claygent_or_mcp_mentioned ILIKE 'yes')                       AS claygent_or_mcp_mentioned_yes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE r.claygent_or_mcp_mentioned ILIKE 'yes')
          / NULLIF(COUNT(*), 0), 2)                                                       AS claygent_or_mcp_mention_rate_pct,
    COUNT(*) FILTER (WHERE r.clay_recommended_followup ILIKE 'yes')                       AS clay_recommended_followup_yes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE r.clay_recommended_followup ILIKE 'yes')
          / NULLIF(COUNT(*), 0), 2)                                                       AS clay_followup_rate_pct,
    COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(r.cited_domains, '[]'::jsonb)) > 0) AS responses_with_citations,
    ROUND(100.0 * COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(r.cited_domains, '[]'::jsonb)) > 0)
          / NULLIF(COUNT(*), 0), 2)                                                       AS citation_coverage_pct,
    COUNT(*) FILTER (WHERE r.brand_sentiment ILIKE 'positive')                            AS brand_sentiment_positive,
    COUNT(*) FILTER (WHERE r.brand_sentiment ILIKE 'neutral')                             AS brand_sentiment_neutral,
    COUNT(*) FILTER (WHERE r.brand_sentiment ILIKE 'negative')                            AS brand_sentiment_negative,
    COUNT(*) FILTER (WHERE r.brand_sentiment ILIKE 'not mentioned')                       AS brand_sentiment_not_mentioned,
    ROUND(100.0 * COUNT(*) FILTER (WHERE r.brand_sentiment ILIKE 'positive')
          / NULLIF(COUNT(*), 0), 2)                                                       AS positive_rate_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE r.brand_sentiment ILIKE 'negative')
          / NULLIF(COUNT(*), 0), 2)                                                       AS negative_rate_pct,
    ROUND(AVG(r.brand_sentiment_score)::numeric, 3)                                       AS avg_brand_sentiment_score,
    ROUND(AVG(r.sentiment_score)::numeric, 3)                                             AS avg_sentiment_score,
    ROUND(AVG(r.number_of_tools_recommended)::numeric, 3)                                 AS avg_number_of_tools_recommended,
    ROUND(SUM(r.total_credits_charged)::numeric, 2)                                       AS total_credits_charged
  FROM responses r
  WHERE r.run_day BETWEEN p_start_day AND p_end_day
  GROUP BY 1, 2, 3, 4
  ORDER BY 1, 3, 4;
$$;

GRANT EXECUTE ON FUNCTION get_weekly_export(DATE, DATE) TO anon, authenticated, service_role;

-- Top competitors per week (mentions counted from JSONB array)
CREATE OR REPLACE FUNCTION get_weekly_top_competitors(
  p_start_day DATE,
  p_end_day   DATE,
  p_limit     INT DEFAULT 10
)
RETURNS TABLE(
  week_start      DATE,
  competitor_name TEXT,
  mention_count   BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '60000'
AS $$
  WITH exploded AS (
    SELECT
      date_trunc('week', r.run_day)::date AS week_start,
      TRIM(BOTH '"' FROM elem::text)      AS competitor_name
    FROM responses r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.competitors_mentioned, '[]'::jsonb)) AS elem
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND jsonb_typeof(elem) = 'string'
  ),
  ranked AS (
    SELECT
      week_start, competitor_name, COUNT(*) AS mention_count,
      ROW_NUMBER() OVER (PARTITION BY week_start ORDER BY COUNT(*) DESC) AS rn
    FROM exploded
    WHERE competitor_name <> ''
    GROUP BY 1, 2
  )
  SELECT week_start, competitor_name, mention_count
  FROM ranked
  WHERE rn <= p_limit
  ORDER BY week_start, mention_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_weekly_top_competitors(DATE, DATE, INT) TO anon, authenticated, service_role;

-- Top cited domains per week (mentions counted from JSONB array)
CREATE OR REPLACE FUNCTION get_weekly_top_cited_domains(
  p_start_day DATE,
  p_end_day   DATE,
  p_limit     INT DEFAULT 10
)
RETURNS TABLE(
  week_start    DATE,
  domain        TEXT,
  mention_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '60000'
AS $$
  WITH exploded AS (
    SELECT
      date_trunc('week', r.run_day)::date AS week_start,
      TRIM(BOTH '"' FROM elem::text)      AS domain
    FROM responses r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.cited_domains, '[]'::jsonb)) AS elem
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND jsonb_typeof(elem) = 'string'
  ),
  ranked AS (
    SELECT
      week_start, domain, COUNT(*) AS mention_count,
      ROW_NUMBER() OVER (PARTITION BY week_start ORDER BY COUNT(*) DESC) AS rn
    FROM exploded
    WHERE domain <> ''
    GROUP BY 1, 2
  )
  SELECT week_start, domain, mention_count
  FROM ranked
  WHERE rn <= p_limit
  ORDER BY week_start, mention_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_weekly_top_cited_domains(DATE, DATE, INT) TO anon, authenticated, service_role;
