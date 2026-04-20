-- ============================================================
-- Fix: incremental cache refresh (replaces full TRUNCATE+rebuild)
-- ============================================================
-- Problem: refresh_dashboard_cache() TRUNCATEs all 6 cache tables
-- then scans ALL historical responses (~125 seconds). The TRUNCATE
-- holds ACCESS EXCLUSIVE locks on all 6 cache tables for the entire
-- 125s transaction. When Clay pushes 5K rows concurrently, connections
-- queue waiting for pool slots, and Clay's 30s timeout is hit.
--
-- Fix: add p_days parameter (default 14). Instead of TRUNCATE, DELETE
-- only recent rows, then INSERT only that date window. Historical data
-- stays correct. Typical runtime: ~3-5s instead of 125s.
--
-- HOW TO RUN:
--   Paste this entire file into the Supabase SQL Editor and run it.
--   No data will be lost -- only the last 14 days of cache are rebuilt.
-- ============================================================

DROP FUNCTION IF EXISTS refresh_dashboard_cache(INT);
DROP FUNCTION IF EXISTS refresh_dashboard_cache();

CREATE OR REPLACE FUNCTION refresh_dashboard_cache(p_days INT DEFAULT 14)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120000'
AS $func$
DECLARE
  v_since DATE := CURRENT_DATE - p_days;
BEGIN
  -- Delete only the window being rebuilt (preserves older history)
  DELETE FROM aeo_cache_daily         WHERE run_day >= v_since;
  DELETE FROM aeo_cache_competitors   WHERE run_day >= v_since;
  DELETE FROM aeo_cache_pmm           WHERE run_day >= v_since;
  DELETE FROM aeo_cache_domains       WHERE run_day >= v_since;
  DELETE FROM aeo_cache_domain_urls   WHERE run_day >= v_since;
  DELETE FROM aeo_cache_topics        WHERE run_day >= v_since;

  -- 1. Core daily metrics
  INSERT INTO aeo_cache_daily (
    run_day, platform, prompt_type,
    total_responses, clay_mentioned, claygent_mentioned, clay_followup,
    clay_cited_responses, total_with_citations,
    sum_position, count_position,
    positive_sentiment, neutral_sentiment, negative_sentiment,
    sum_sentiment_score, count_sentiment_score
  )
  WITH citation_flags AS (
    SELECT
      cd.response_id,
      TRUE                                              AS has_any,
      BOOL_OR(LOWER(cd.domain) LIKE '%clay%')           AS has_clay
    FROM citation_domains cd
    JOIN responses r2 ON r2.id = cd.response_id
    WHERE cd.response_id IS NOT NULL
      AND r2.run_day >= v_since
    GROUP BY cd.response_id
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')                                        AS prompt_type,
    COUNT(*)                                                                   AS total_responses,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')                       AS clay_mentioned,
    COUNT(*) FILTER (WHERE r.claygent_or_mcp_mentioned ILIKE 'yes')            AS claygent_mentioned,
    COUNT(*) FILTER (WHERE r.clay_recommended_followup ILIKE 'yes')            AS clay_followup,
    COUNT(*) FILTER (WHERE cf.has_clay)                                        AS clay_cited_responses,
    COUNT(*) FILTER (WHERE cf.has_any)                                         AS total_with_citations,
    SUM(r.clay_mention_position::float)
      FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.clay_mention_position IS NOT NULL)
                                                                               AS sum_position,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.clay_mention_position IS NOT NULL)
                                                                               AS count_position,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Positive')
                                                                               AS positive_sentiment,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Neutral')
                                                                               AS neutral_sentiment,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment = 'Negative')
                                                                               AS negative_sentiment,
    SUM(r.brand_sentiment_score::float)
      FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL)
                                                                               AS sum_sentiment_score,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.brand_sentiment_score IS NOT NULL)
                                                                               AS count_sentiment_score
  FROM responses r
  LEFT JOIN citation_flags cf ON cf.response_id = r.id
  WHERE r.run_day >= v_since
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__');

  -- 2. Competitor mentions
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
    AND r.run_day >= v_since
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), rc.competitor_name;

  -- 3. PMM metrics
  INSERT INTO aeo_cache_pmm (
    run_day, platform, prompt_type,
    pmm_use_case, pmm_classification,
    total_responses, clay_mentioned, clay_cited,
    sum_position, count_position
  )
  WITH pmm_citation_flags AS (
    SELECT
      cd.response_id,
      BOOL_OR(LOWER(cd.domain) LIKE '%clay%') AS has_clay
    FROM citation_domains cd
    JOIN responses r2 ON r2.id = cd.response_id
    WHERE cd.response_id IS NOT NULL
      AND r2.run_day >= v_since
    GROUP BY cd.response_id
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')                                        AS prompt_type,
    r.pmm_use_case,
    COALESCE(r.pmm_classification, '__none__')                                 AS pmm_classification,
    COUNT(*)                                                                   AS total_responses,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')                       AS clay_mentioned,
    COUNT(*) FILTER (WHERE cf.has_clay)                                        AS clay_cited,
    SUM(r.clay_mention_position::float)
      FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.clay_mention_position IS NOT NULL)
                                                                               AS sum_position,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes' AND r.clay_mention_position IS NOT NULL)
                                                                               AS count_position
  FROM responses r
  LEFT JOIN pmm_citation_flags cf ON cf.response_id = r.id
  WHERE r.pmm_use_case IS NOT NULL
    AND r.run_day >= v_since
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'),
           r.pmm_use_case, COALESCE(r.pmm_classification, '__none__');

  -- 4. Domain citations
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
    AND r.run_day >= v_since
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), LOWER(cd.domain);

  -- 5. Domain URLs
  INSERT INTO aeo_cache_domain_urls (
    run_day, platform, prompt_type, domain, url, title, url_type, url_count
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')   AS prompt_type,
    LOWER(cd.domain)                      AS domain,
    cd.url,
    MAX(cd.title)                         AS title,
    MAX(cd.url_type)                      AS url_type,
    COUNT(*)                              AS url_count
  FROM citation_domains cd
  JOIN responses r ON r.id = cd.response_id
  WHERE cd.domain IS NOT NULL AND cd.url IS NOT NULL
    AND r.run_day >= v_since
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'),
           LOWER(cd.domain), cd.url;

  -- 6. Topic visibility
  INSERT INTO aeo_cache_topics (
    run_day, platform, prompt_type, topic, total_responses, clay_mentioned, clay_cited
  )
  WITH topic_citation_flags AS (
    SELECT
      cd.response_id,
      BOOL_OR(LOWER(cd.domain) LIKE '%clay%') AS has_clay
    FROM citation_domains cd
    JOIN responses r2 ON r2.id = cd.response_id
    WHERE cd.response_id IS NOT NULL
      AND r2.run_day >= v_since
    GROUP BY cd.response_id
  )
  SELECT
    r.run_day,
    r.platform,
    COALESCE(r.prompt_type, '__none__')                                        AS prompt_type,
    COALESCE(r.topic, 'Unknown')                                               AS topic,
    COUNT(*)                                                                   AS total_responses,
    COUNT(*) FILTER (WHERE r.clay_mentioned ILIKE 'yes')                       AS clay_mentioned,
    COUNT(*) FILTER (WHERE cf.has_clay)                                        AS clay_cited
  FROM responses r
  LEFT JOIN topic_citation_flags cf ON cf.response_id = r.id
  WHERE r.run_day >= v_since
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), COALESCE(r.topic, 'Unknown');

  RAISE NOTICE 'Incremental cache refresh done: % days from %, finished at %', p_days, CURRENT_DATE, NOW();
END;
$func$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_cache(INT) TO anon, authenticated;

-- Wrapper so existing callers (cron, API) work with no changes
CREATE OR REPLACE FUNCTION refresh_dashboard_cache()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $func$
  SELECT refresh_dashboard_cache(14);
$func$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_cache() TO anon, authenticated;
