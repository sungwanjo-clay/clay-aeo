-- ============================================================
-- Speed up the Citations tab
-- ============================================================
-- Four queries were doing full raw-table scans on large tables.
-- This migration:
--   1. Adds url_type to aeo_cache_domain_urls
--   2. Adds clay_cited to aeo_cache_topics
--   3. Recreates refresh_dashboard_cache() to populate new columns
--   4. Recreates get_top_cited_domains_rpc to return url_type in JSONB
--   5. Rebuilds the cache
--
-- After this runs, four query functions switch to fast cache reads:
--   getTopCitedDomainsEnhanced  → get_top_cited_domains_rpc (fast path)
--   getCitationTypeBreakdown    → aeo_cache_domains
--   getCitationCoverage         → aeo_cache_daily + aeo_cache_domains
--   getCitationRateByTopic      → aeo_cache_topics (new clay_cited column)
-- ============================================================


-- ── Step 1: Add new columns ──────────────────────────────────

ALTER TABLE aeo_cache_domain_urls
  ADD COLUMN IF NOT EXISTS url_type TEXT;

ALTER TABLE aeo_cache_topics
  ADD COLUMN IF NOT EXISTS clay_cited BIGINT NOT NULL DEFAULT 0;


-- ── Step 2: Recreate refresh_dashboard_cache() ───────────────
-- Inherits citation_domains-based total_with_citations (from reconcile_citation_sources.sql).
-- Now also populates url_type in domain_urls and clay_cited in topics.

DROP FUNCTION IF EXISTS refresh_dashboard_cache();

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
  -- total_with_citations and clay_cited_responses use citation_domains (not JSONB)
  -- so the cache stays accurate even when cited_domains column is unpopulated.
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
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = responses.id
        AND LOWER(cd.domain) LIKE '%clay%'
    ))                                                                       AS clay_cited_responses,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = responses.id
    ))                                                                       AS total_with_citations,
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

  -- ── 5. Domain URLs (now includes url_type) ─────────────────
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

  -- ── 6. Topic visibility (now includes clay_cited) ──────────
  INSERT INTO aeo_cache_topics (
    run_day, platform, prompt_type, topic, total_responses, clay_mentioned, clay_cited
  )
  SELECT
    run_day,
    platform,
    COALESCE(prompt_type, '__none__')                                        AS prompt_type,
    COALESCE(topic, 'Unknown')                                               AS topic,
    COUNT(*)                                                                 AS total_responses,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')                       AS clay_mentioned,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = responses.id
        AND LOWER(cd.domain) LIKE '%clay%'
    ))                                                                       AS clay_cited
  FROM responses
  GROUP BY run_day, platform, COALESCE(prompt_type, '__none__'), COALESCE(topic, 'Unknown');

  RAISE NOTICE 'Dashboard cache refreshed at %', NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_cache() TO anon, authenticated;


-- ── Step 3: Update get_top_cited_domains_rpc to return url_type ──

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
    -- ── Fast path: pre-aggregated cache tables ────────────────
    RETURN QUERY
    WITH domain_agg AS (
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
    -- Correct denominator: unique responses with any citation for the period.
    total_cited AS (
      SELECT SUM(d.total_with_citations)::float AS n
      FROM aeo_cache_daily d
      WHERE d.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
    ),
    url_agg AS (
      SELECT
        du.domain                                                                     AS dname,
        du.url,
        MAX(du.title)                                                                 AS title,
        MAX(du.url_type)                                                              AS url_type,
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
          jsonb_build_object(
            'url', ua.url,
            'title', ua.title,
            'count', ua.cnt,
            'url_type', ua.url_type
          )
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
    -- ── Slow path: scan citation_domains + responses ──────────
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
      SELECT LOWER(cd.domain) AS dname, cd.url, cd.title, cd.url_type,
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
      SELECT c.dname, c.url, MAX(c.title) AS title, MAX(c.url_type) AS url_type,
             COUNT(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY c.dname ORDER BY COUNT(*) DESC) AS rn
      FROM citations c WHERE c.url IS NOT NULL
      GROUP BY c.dname, c.url
    ),
    top_urls AS (
      SELECT ur.dname,
        jsonb_agg(
          jsonb_build_object(
            'url', ur.url,
            'title', ur.title,
            'count', ur.cnt,
            'url_type', ur.url_type
          )
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


-- ── Step 4: Rebuild cache with new columns ───────────────────

SELECT refresh_dashboard_cache();
