-- ============================================================
-- Fix: cache refresh performance + competitive tab data
-- ============================================================
-- Problem: refresh_dashboard_cache() used correlated EXISTS subqueries
-- against citation_domains with no index on citation_domains.response_id.
-- For 100k responses × EXISTS scan of citation_domains = very slow / timeout,
-- leaving aeo_cache_daily empty → competitive KPI tiles show dashes.
--
-- Fix:
--   1. Add index on citation_domains(response_id) — used by EXISTS and JOINs
--   2. Rewrite refresh_dashboard_cache() to use a pre-aggregated CTE
--      (citation_flags) instead of correlated EXISTS per row. Single pass
--      over citation_domains, then LEFT JOIN to responses. Fast with index.
--   3. Re-run the cache so the competitive tab gets data immediately.
-- ============================================================


-- ── Step 1: Index citation_domains(response_id) ──────────────
-- This index is used by the new CTE JOIN and by getCitationURLContext lazy loads.

CREATE INDEX IF NOT EXISTS idx_citation_domains_response_id
  ON citation_domains (response_id);


-- ── Step 2: Rewrite refresh_dashboard_cache() ────────────────
-- Uses a citation_flags CTE instead of correlated EXISTS:
--   citation_flags = one row per response_id with has_any + has_clay booleans.
--   Then LEFT JOIN responses → citation_flags for O(N) instead of O(N²).

DROP FUNCTION IF EXISTS refresh_dashboard_cache();

CREATE OR REPLACE FUNCTION refresh_dashboard_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300000'
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
  -- Pre-aggregate citation_domains once (citation_flags CTE), then
  -- LEFT JOIN to responses. Avoids correlated subquery per row.
  INSERT INTO aeo_cache_daily (
    run_day, platform, prompt_type,
    total_responses, clay_mentioned, claygent_mentioned, clay_followup,
    clay_cited_responses, total_with_citations,
    sum_position, count_position,
    positive_sentiment, neutral_sentiment, negative_sentiment,
    sum_sentiment_score, count_sentiment_score
  )
  WITH citation_flags AS (
    -- One row per response_id: has any citation, has clay citation
    SELECT
      response_id,
      TRUE                                              AS has_any,
      BOOL_OR(LOWER(domain) LIKE '%clay%')              AS has_clay
    FROM citation_domains
    WHERE response_id IS NOT NULL
    GROUP BY response_id
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
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__');

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
  WITH pmm_citation_flags AS (
    SELECT
      response_id,
      BOOL_OR(LOWER(domain) LIKE '%clay%') AS has_clay
    FROM citation_domains
    WHERE response_id IS NOT NULL
    GROUP BY response_id
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
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'),
           r.pmm_use_case, COALESCE(r.pmm_classification, '__none__');

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

  -- ── 5. Domain URLs (includes url_type) ────────────────────
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
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'),
           LOWER(cd.domain), cd.url;

  -- ── 6. Topic visibility (includes clay_cited) ─────────────
  INSERT INTO aeo_cache_topics (
    run_day, platform, prompt_type, topic, total_responses, clay_mentioned, clay_cited
  )
  WITH topic_citation_flags AS (
    SELECT
      response_id,
      BOOL_OR(LOWER(domain) LIKE '%clay%') AS has_clay
    FROM citation_domains
    WHERE response_id IS NOT NULL
    GROUP BY response_id
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
  GROUP BY r.run_day, r.platform, COALESCE(r.prompt_type, '__none__'), COALESCE(r.topic, 'Unknown');

  RAISE NOTICE 'Dashboard cache refreshed at %', NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_cache() TO anon, authenticated;


-- ── Step 3: Rebuild cache with correct, fast function ────────

SELECT refresh_dashboard_cache();
