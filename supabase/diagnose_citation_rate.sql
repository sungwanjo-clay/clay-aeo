-- ============================================================
-- diagnose_citation_rate.sql
-- Verify Clay citation rate: numerator (clay.com cited) /
-- denominator (responses with any citation returned)
-- Check cache vs raw table, broken out by platform
-- ============================================================

-- ── 1. RAW TABLE: Citation rate by platform (today) ──────────
-- Exact math: clay_cited / total_with_any_citation
SELECT
  platform,
  COUNT(*)                                                           AS total_responses,
  COUNT(*) FILTER (
    WHERE cited_domains IS NOT NULL
      AND jsonb_array_length(cited_domains) > 0
  )                                                                  AS total_with_citations,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(cited_domains) d
      WHERE d ILIKE '%clay%'
    )
  )                                                                  AS clay_cited_responses,
  ROUND(
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(cited_domains) d
      WHERE d ILIKE '%clay%'
    ))::numeric
    / NULLIF(COUNT(*) FILTER (
        WHERE cited_domains IS NOT NULL
          AND jsonb_array_length(cited_domains) > 0
      ), 0) * 100,
    4
  )                                                                  AS clay_citation_rate_pct
FROM responses
WHERE run_day = CURRENT_DATE
  AND prompt_type ILIKE 'benchmark'
GROUP BY platform
ORDER BY platform;


-- ── 2. CACHE TABLE: Same numbers (should match row 1) ────────
SELECT
  platform,
  SUM(total_responses)      AS total_responses,
  SUM(total_with_citations) AS total_with_citations,
  SUM(clay_cited_responses) AS clay_cited_responses,
  ROUND(
    SUM(clay_cited_responses)::numeric
    / NULLIF(SUM(total_with_citations), 0) * 100,
    4
  )                         AS clay_citation_rate_pct
FROM aeo_cache_daily
WHERE run_day = CURRENT_DATE
  AND prompt_type ILIKE 'benchmark'
GROUP BY platform
ORDER BY platform;


-- ── 3. WHAT clay domains are actually being cited for Claude? ─
-- Shows the exact strings in cited_domains that match '%clay%'
SELECT
  d.value::text  AS cited_domain,
  COUNT(*)       AS times_cited
FROM responses r,
  jsonb_array_elements_text(r.cited_domains) d
WHERE r.run_day = CURRENT_DATE
  AND r.platform ILIKE '%claude%'
  AND r.prompt_type ILIKE 'benchmark'
  AND d.value ILIKE '%clay%'
GROUP BY d.value
ORDER BY times_cited DESC
LIMIT 30;


-- ── 4. SPOT CHECK: Are Claude's cited_domains actually populated?
-- Shows sample rows to confirm the JSONB data looks right
SELECT
  id,
  platform,
  run_day,
  cited_domains,
  jsonb_array_length(cited_domains) AS num_citations
FROM responses
WHERE run_day = CURRENT_DATE
  AND platform ILIKE '%claude%'
  AND prompt_type ILIKE 'benchmark'
  AND cited_domains IS NOT NULL
  AND jsonb_array_length(cited_domains) > 0
ORDER BY RANDOM()
LIMIT 5;


-- ── 5. SANITY CHECK: Clay citation rate over all days by platform
SELECT
  run_day,
  platform,
  SUM(total_responses)      AS total,
  SUM(total_with_citations) AS with_citations,
  SUM(clay_cited_responses) AS clay_cited,
  ROUND(
    SUM(clay_cited_responses)::numeric
    / NULLIF(SUM(total_with_citations), 0) * 100,
    4
  )                         AS citation_rate_pct
FROM aeo_cache_daily
WHERE prompt_type ILIKE 'benchmark'
GROUP BY run_day, platform
ORDER BY run_day DESC, platform;
