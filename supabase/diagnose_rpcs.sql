-- ============================================================
-- diagnose_rpcs.sql
-- Tests every RPC the home page calls with exact frontend params
-- Run each block separately and look for ERROR vs empty vs data
-- ============================================================

-- ── What dates are in the cache? ─────────────────────────────
SELECT DISTINCT run_day, platform, prompt_type,
  total_responses, clay_mentioned, claygent_mentioned
FROM aeo_cache_daily
ORDER BY run_day DESC
LIMIT 20;

-- ── Confirm default frontend params ──────────────────────────
-- promptType = 'benchmark' (lowercase), platforms = null,
-- branded_filter = 'all', tags = 'all'
-- Dates: today-7 → today  (adjust if needed)

-- ── TIER 1 RPCs ──────────────────────────────────────────────

-- 1a. get_visibility_kpis (must return 1 row)
SELECT * FROM get_visibility_kpis(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prev_start_day := '2026-03-26',
  p_prev_end_day   := '2026-04-02',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
);

-- 1b. get_citation_share_kpi (must return 1 row)
SELECT * FROM get_citation_share_kpi(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prev_start_day := '2026-03-26',
  p_prev_end_day   := '2026-04-02',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
);

-- 1c. get_sentiment_breakdown_rpc (must return 1 row)
SELECT * FROM get_sentiment_breakdown_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
);

-- ── TIER 2 RPCs ──────────────────────────────────────────────

-- 2a. get_competitor_leaderboard_rpc (should return rows)
SELECT * FROM get_competitor_leaderboard_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prev_start_day := '2026-03-26',
  p_prev_end_day   := '2026-04-02',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
) LIMIT 5;

-- 2b. get_visibility_timeseries_rpc (should return date rows)
SELECT * FROM get_visibility_timeseries_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
);

-- 2c. get_competitor_visibility_timeseries_rpc (should return rows)
SELECT * FROM get_competitor_visibility_timeseries_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
) LIMIT 5;

-- ── TIER 3 RPCs ──────────────────────────────────────────────

-- 3a. get_citation_timeseries_rpc
SELECT * FROM get_citation_timeseries_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
);

-- 3b. get_top_cited_domains_rpc (should return domains)
SELECT domain, citation_count FROM get_top_cited_domains_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
) LIMIT 5;

-- 3c. get_competitor_citation_timeseries_rpc
SELECT * FROM get_competitor_citation_timeseries_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all',
  p_top_n          := 5
) LIMIT 10;

-- 3d. get_visibility_by_pmm_rpc
SELECT * FROM get_visibility_by_pmm_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
) LIMIT 5;

-- 3e. get_pmm_table_rpc (should return PMM rows)
SELECT pmm_use_case, pmm_classification, visibility_score
FROM get_pmm_table_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prev_start_day := '2026-03-26',
  p_prev_end_day   := '2026-04-02',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
) LIMIT 5;

-- 3f. get_claygent_timeseries_rpc (should return date+count rows)
SELECT * FROM get_claygent_timeseries_rpc(
  p_start_day      := '2026-04-03',
  p_end_day        := '2026-04-10',
  p_prompt_type    := 'benchmark',
  p_platforms      := NULL,
  p_branded_filter := 'all',
  p_tags           := 'all'
);
