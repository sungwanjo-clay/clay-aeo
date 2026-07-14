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


-- ============================================================
-- Per-URL and per-domain weekly aggregations from responses.citations
--
-- One row per (ISO week × url) with citation counts, per-platform /
-- per-prompt-type / per-citation-type splits, url-type mode, and
-- clay_mention_rate for the responses that cite the URL.
-- Response-level fields that don't make sense per-URL (brand sentiment,
-- clay_mention_position, credits, tools recommended) are excluded.
-- ============================================================

CREATE OR REPLACE FUNCTION get_weekly_url_citations(
  p_start_day DATE,
  p_end_day   DATE
)
RETURNS TABLE(
  week_start                                 DATE,
  week_end                                   DATE,
  url                                        TEXT,
  domain                                     TEXT,
  title_most_common                          TEXT,
  citation_count                             BIGINT,
  responses_citing                           BIGINT,
  unique_prompts                             BIGINT,
  unique_topics                              BIGINT,
  chatgpt_responses                          BIGINT,
  claude_responses                           BIGINT,
  benchmark_responses                        BIGINT,
  branded_responses                          BIGINT,
  citation_type_competition                  BIGINT,
  citation_type_other                        BIGINT,
  url_type_most_common                       TEXT,
  clay_mention_rate_pct_of_citing_responses  NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '120000'
AS $$
  WITH exploded AS (
    SELECT
      date_trunc('week', r.run_day)::date AS week_start,
      r.id, r.platform, r.prompt_type, r.prompt_id, r.topic, r.clay_mentioned,
      c->>'url'     AS url,
      c->>'domain'  AS domain,
      c->>'title'   AS title,
      c->>'type'    AS citation_type,
      c->>'urlType' AS url_type
    FROM responses r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.citations, '[]'::jsonb)) AS c
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND (c->>'url') IS NOT NULL
  ),
  -- One (week, url, response) row per unique citing response, so per-response
  -- counts don't double-count when the same response cites the same URL twice.
  per_response AS (
    SELECT DISTINCT week_start, url, id, platform, prompt_type, prompt_id, topic, clay_mentioned,
                    FIRST_VALUE(domain) OVER (PARTITION BY week_start, url ORDER BY (domain IS NULL), domain) AS domain
    FROM exploded
  ),
  title_mode AS (
    SELECT week_start, url, title AS title_most_common,
           ROW_NUMBER() OVER (PARTITION BY week_start, url ORDER BY COUNT(*) DESC, title) AS rn
    FROM exploded
    WHERE title IS NOT NULL AND title <> ''
    GROUP BY 1, 2, 3
  ),
  urltype_mode AS (
    SELECT week_start, url, url_type AS url_type_most_common,
           ROW_NUMBER() OVER (PARTITION BY week_start, url ORDER BY COUNT(*) DESC, url_type) AS rn
    FROM exploded
    WHERE url_type IS NOT NULL AND url_type <> ''
    GROUP BY 1, 2, 3
  )
  SELECT
    e.week_start,
    (e.week_start + INTERVAL '6 days')::date                             AS week_end,
    e.url,
    MAX(pr.domain)                                                       AS domain,
    (SELECT title_most_common FROM title_mode WHERE week_start = e.week_start AND url = e.url AND rn = 1) AS title_most_common,
    COUNT(*)                                                             AS citation_count,
    COUNT(DISTINCT pr.id)                                                AS responses_citing,
    COUNT(DISTINCT pr.prompt_id)                                         AS unique_prompts,
    COUNT(DISTINCT pr.topic)                                             AS unique_topics,
    COUNT(DISTINCT pr.id) FILTER (WHERE pr.platform = 'ChatGPT')         AS chatgpt_responses,
    COUNT(DISTINCT pr.id) FILTER (WHERE pr.platform = 'Claude')          AS claude_responses,
    COUNT(DISTINCT pr.id) FILTER (WHERE pr.prompt_type ILIKE 'benchmark') AS benchmark_responses,
    COUNT(DISTINCT pr.id) FILTER (WHERE pr.prompt_type ILIKE 'branded')   AS branded_responses,
    COUNT(*) FILTER (WHERE e.citation_type ILIKE 'competition')          AS citation_type_competition,
    COUNT(*) FILTER (WHERE e.citation_type IS NULL OR NOT (e.citation_type ILIKE 'competition')) AS citation_type_other,
    (SELECT url_type_most_common FROM urltype_mode WHERE week_start = e.week_start AND url = e.url AND rn = 1) AS url_type_most_common,
    ROUND(100.0 * COUNT(DISTINCT pr.id) FILTER (WHERE pr.clay_mentioned ILIKE 'yes')
          / NULLIF(COUNT(DISTINCT pr.id), 0), 2)                         AS clay_mention_rate_pct_of_citing_responses
  FROM exploded e
  LEFT JOIN per_response pr
    ON pr.week_start = e.week_start AND pr.url = e.url AND pr.id = e.id
  GROUP BY e.week_start, e.url
  ORDER BY e.week_start, citation_count DESC, e.url;
$$;

GRANT EXECUTE ON FUNCTION get_weekly_url_citations(DATE, DATE) TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION get_weekly_domain_citations(
  p_start_day DATE,
  p_end_day   DATE
)
RETURNS TABLE(
  week_start                                 DATE,
  week_end                                   DATE,
  domain                                     TEXT,
  citation_count                             BIGINT,
  unique_urls                                BIGINT,
  responses_citing                           BIGINT,
  unique_prompts                             BIGINT,
  unique_topics                              BIGINT,
  chatgpt_responses                          BIGINT,
  claude_responses                           BIGINT,
  benchmark_responses                        BIGINT,
  branded_responses                          BIGINT,
  citation_type_competition                  BIGINT,
  citation_type_other                        BIGINT,
  url_type_most_common                       TEXT,
  clay_mention_rate_pct_of_citing_responses  NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '120000'
AS $$
  WITH exploded AS (
    SELECT
      date_trunc('week', r.run_day)::date AS week_start,
      r.id, r.platform, r.prompt_type, r.prompt_id, r.topic, r.clay_mentioned,
      c->>'url'     AS url,
      c->>'domain'  AS domain,
      c->>'type'    AS citation_type,
      c->>'urlType' AS url_type
    FROM responses r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.citations, '[]'::jsonb)) AS c
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND (c->>'domain') IS NOT NULL
  ),
  urltype_mode AS (
    SELECT week_start, domain, url_type AS url_type_most_common,
           ROW_NUMBER() OVER (PARTITION BY week_start, domain ORDER BY COUNT(*) DESC, url_type) AS rn
    FROM exploded
    WHERE url_type IS NOT NULL AND url_type <> ''
    GROUP BY 1, 2, 3
  )
  SELECT
    e.week_start,
    (e.week_start + INTERVAL '6 days')::date                             AS week_end,
    e.domain,
    COUNT(*)                                                             AS citation_count,
    COUNT(DISTINCT e.url)                                                AS unique_urls,
    COUNT(DISTINCT e.id)                                                 AS responses_citing,
    COUNT(DISTINCT e.prompt_id)                                          AS unique_prompts,
    COUNT(DISTINCT e.topic)                                              AS unique_topics,
    COUNT(DISTINCT e.id) FILTER (WHERE e.platform = 'ChatGPT')           AS chatgpt_responses,
    COUNT(DISTINCT e.id) FILTER (WHERE e.platform = 'Claude')            AS claude_responses,
    COUNT(DISTINCT e.id) FILTER (WHERE e.prompt_type ILIKE 'benchmark')  AS benchmark_responses,
    COUNT(DISTINCT e.id) FILTER (WHERE e.prompt_type ILIKE 'branded')    AS branded_responses,
    COUNT(*) FILTER (WHERE e.citation_type ILIKE 'competition')          AS citation_type_competition,
    COUNT(*) FILTER (WHERE e.citation_type IS NULL OR NOT (e.citation_type ILIKE 'competition')) AS citation_type_other,
    (SELECT url_type_most_common FROM urltype_mode WHERE week_start = e.week_start AND domain = e.domain AND rn = 1) AS url_type_most_common,
    ROUND(100.0 * COUNT(DISTINCT e.id) FILTER (WHERE e.clay_mentioned ILIKE 'yes')
          / NULLIF(COUNT(DISTINCT e.id), 0), 2)                          AS clay_mention_rate_pct_of_citing_responses
  FROM exploded e
  GROUP BY e.week_start, e.domain
  ORDER BY e.week_start, citation_count DESC, e.domain;
$$;

GRANT EXECUTE ON FUNCTION get_weekly_domain_citations(DATE, DATE) TO anon, authenticated, service_role;
