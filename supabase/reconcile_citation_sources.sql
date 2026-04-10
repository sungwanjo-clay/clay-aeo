-- ============================================================
-- Reconcile citation data sources: cited_domains JSONB vs citation_domains table
-- ============================================================
-- Background:
--   Two sources track "which responses cited which domains":
--     1. responses.cited_domains  — JSONB array populated at ingestion.
--        Used by aeo_cache_daily for total_with_citations and clay_cited_responses.
--     2. citation_domains         — relational table (one row per response×domain),
--        populated separately. Used by aeo_cache_domains.response_count.
--
--   These diverge by ~39%: some responses have citation_domains rows but an empty
--   (or NULL) cited_domains JSONB. This causes inconsistencies between KPIs/timeseries
--   (which use the JSONB) and the domain citation counts (which use the table).
--
-- This script performs three steps:
--   Step 1 — Backfill: populate cited_domains JSONB from citation_domains for all
--             responses where JSONB is missing/empty but relational rows exist.
--             Safe to re-run (idempotent): the WHERE clause only targets rows that
--             still have empty/NULL cited_domains AND have citation_domains rows.
--   Step 2 — Refresh cache: rebuild all cache tables with the now-correct JSONB data.
--   Step 3 — Permanent fix: replace refresh_dashboard_cache() so that
--             total_with_citations and clay_cited_responses are computed from
--             citation_domains (via EXISTS) rather than cited_domains JSONB.
--             This ensures future ingestions that miss populating cited_domains
--             still produce correct cache values.
-- ============================================================


-- ============================================================
-- STEP 1: Backfill cited_domains JSONB from citation_domains
-- ============================================================
-- For every response that has citation_domains rows but a NULL or empty
-- cited_domains JSONB, rebuild cited_domains as an aggregated JSONB array of
-- distinct lowercased domains from citation_domains.
--
-- Idempotent: subsequent runs will find no rows matching the WHERE clause
-- (because cited_domains will already be non-empty after the first run).

UPDATE responses r
SET cited_domains = (
  SELECT jsonb_agg(DISTINCT LOWER(cd.domain))
  FROM citation_domains cd
  WHERE cd.response_id = r.id
    AND cd.domain IS NOT NULL
)
WHERE (r.cited_domains IS NULL OR jsonb_array_length(r.cited_domains) = 0)
  AND EXISTS (
    SELECT 1 FROM citation_domains cd2 WHERE cd2.response_id = r.id
  );


-- ============================================================
-- STEP 2: Rebuild cache with the corrected JSONB data
-- ============================================================
-- Now that cited_domains is populated for previously-missing responses,
-- refresh_dashboard_cache() will produce accurate total_with_citations and
-- clay_cited_responses values.

SELECT refresh_dashboard_cache();


-- ============================================================
-- STEP 3: Permanent fix — update refresh_dashboard_cache()
-- ============================================================
-- Change the computation of total_with_citations and clay_cited_responses in
-- aeo_cache_daily to use citation_domains as the primary source (via EXISTS),
-- rather than the cited_domains JSONB column.
--
-- Rationale: if future ingestions omit populating cited_domains, the cache
-- will still be correct because it now reads directly from the authoritative
-- citation_domains relational table.
--
-- All other columns and logic are preserved exactly as-is.

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
  -- NOTE: total_with_citations and clay_cited_responses now use EXISTS against
  -- citation_domains rather than cited_domains JSONB. This keeps the cache
  -- accurate even when cited_domains is not populated at ingestion time.
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
    -- clay_cited_responses: responses that have a citation_domains row for a
    -- clay domain. Uses citation_domains as primary source for reliability.
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM citation_domains cd
      WHERE cd.response_id = responses.id
        AND LOWER(cd.domain) LIKE '%clay%'
    ))                                                                       AS clay_cited_responses,
    -- total_with_citations: responses that have at least one citation_domains row.
    -- Uses citation_domains as primary source for reliability.
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
