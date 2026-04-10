-- ============================================================
-- Dashboard KPI RPCs
-- Run this in the Supabase SQL Editor.
--
-- Replaces JS-side fetchAllPages + in-memory aggregation with
-- server-side SQL. Each RPC does one round trip instead of
-- 9+ paginated fetches.
-- ============================================================

-- ── Indexes ─────────────────────────────────────────────────
-- These make the WHERE clauses fast. Safe to re-run (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_responses_run_day
  ON responses(run_day);

CREATE INDEX IF NOT EXISTS idx_responses_run_day_prompt_type
  ON responses(run_day, prompt_type);

CREATE INDEX IF NOT EXISTS idx_responses_clay_mentioned
  ON responses(clay_mentioned);

CREATE INDEX IF NOT EXISTS idx_responses_claygent
  ON responses(claygent_or_mcp_mentioned);

CREATE INDEX IF NOT EXISTS idx_response_competitors_response_id
  ON response_competitors(response_id);

CREATE INDEX IF NOT EXISTS idx_citation_domains_response_id
  ON citation_domains(response_id);

-- ── Shared filter helper (inline macro via SQL function) ─────

-- Returns TRUE if the response row passes all global filters.
-- Used inside every RPC to keep filter logic in one place.
CREATE OR REPLACE FUNCTION passes_filters(
  r_run_day              DATE,
  r_platform             TEXT,
  r_prompt_type          TEXT,
  r_branded_or_non_branded TEXT,
  r_tags                 TEXT,
  p_start_day            DATE,
  p_end_day              DATE,
  p_prompt_type          TEXT,   -- 'all' or specific value
  p_platforms            TEXT[], -- NULL or empty array = all platforms
  p_branded_filter       TEXT,   -- 'all' | 'branded' | 'non-branded'
  p_tags                 TEXT    -- 'all' or specific tag
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT
    r_run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all'  OR r_prompt_type ILIKE p_prompt_type)
    -- NULL or empty array means "all platforms"
    AND (p_platforms IS NULL OR array_length(p_platforms, 1) IS NULL OR r_platform = ANY(p_platforms))
    AND (
      p_branded_filter = 'all'
      OR (p_branded_filter = 'branded'     AND r_branded_or_non_branded ILIKE 'branded')
      OR (p_branded_filter = 'non-branded' AND r_branded_or_non_branded NOT ILIKE 'branded')
    )
    AND (p_tags = 'all' OR r_tags = p_tags)
$$;


-- ── RPC 1: Visibility + Avg Position + Claygent (3 KPIs, 2 periods) ─
-- NOTE: Uses RETURNS TABLE (not JSON) so Supabase JS returns data[0].field correctly.

CREATE OR REPLACE FUNCTION get_visibility_kpis(
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
  vis_current        FLOAT,
  vis_previous       FLOAT,
  vis_total          BIGINT,
  pos_current        FLOAT,
  pos_previous       FLOAT,
  claygent_current   BIGINT,
  claygent_previous  BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
DECLARE
  v_cur_total    BIGINT; v_cur_clay     BIGINT;
  v_cur_pos      FLOAT;  v_cur_claygent BIGINT;
  v_prev_total   BIGINT; v_prev_clay    BIGINT;
  v_prev_pos     FLOAT;  v_prev_claygent BIGINT;
  v_prompt_count BIGINT;
BEGIN
  -- Current period
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'),
    AVG(clay_mention_position::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL),
    COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
  INTO v_cur_total, v_cur_clay, v_cur_pos, v_cur_claygent
  FROM responses
  WHERE passes_filters(
    run_day, platform, prompt_type, branded_or_non_branded, tags,
    p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
  );

  -- Previous period
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'),
    AVG(clay_mention_position::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND clay_mention_position IS NOT NULL),
    COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
  INTO v_prev_total, v_prev_clay, v_prev_pos, v_prev_claygent
  FROM responses
  WHERE passes_filters(
    run_day, platform, prompt_type, branded_or_non_branded, tags,
    p_prev_start_day, p_prev_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
  );

  -- Active prompt count
  SELECT COUNT(*) INTO v_prompt_count
  FROM prompts
  WHERE is_active = true
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_tags = 'all' OR tags = p_tags);

  RETURN QUERY SELECT
    CASE WHEN v_cur_total  > 0 THEN v_cur_clay::float  / v_cur_total  * 100 ELSE NULL END,
    CASE WHEN v_prev_total > 0 THEN v_prev_clay::float / v_prev_total * 100 ELSE NULL END,
    v_prompt_count,
    v_cur_pos,
    v_prev_pos,
    v_cur_claygent,
    v_prev_claygent;
END;
$$;

GRANT EXECUTE ON FUNCTION get_visibility_kpis(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 2: Citation share KPI (no JOIN — uses cited_domains on responses) ─────
-- Optimized: reads cited_domains TEXT[] column directly from responses.
-- Eliminates the expensive JOIN to citation_domains that caused statement_timeout.
-- Denominator = responses with any citation (array_length > 0).
-- Numerator   = responses where cited_domains contains a clay.com domain.
-- Both computed in a single table scan — no child table JOIN needed.

CREATE OR REPLACE FUNCTION get_citation_share_kpi(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prev_start_day DATE,
  p_prev_end_day   DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(current_pct FLOAT, previous_pct FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT
      (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
      (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
      -- has_citation: response has at least one cited domain
      (cited_domains IS NOT NULL AND jsonb_array_length(cited_domains) > 0) AS has_citation,
      -- has_clay: at least one cited domain contains 'clay'
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
      COUNT(*) FILTER (WHERE is_cur  AND has_citation)              AS cur_n,
      COUNT(*) FILTER (WHERE is_cur  AND has_citation AND has_clay) AS cur_c,
      COUNT(*) FILTER (WHERE is_prev AND has_citation)              AS prev_n,
      COUNT(*) FILTER (WHERE is_prev AND has_citation AND has_clay) AS prev_c
    FROM filtered
  )
  SELECT
    CASE WHEN cur_n  > 0 THEN cur_c::float  / cur_n  * 100 ELSE NULL END,
    CASE WHEN prev_n > 0 THEN prev_c::float / prev_n * 100 ELSE NULL END
  FROM agg
$$;

GRANT EXECUTE ON FUNCTION get_citation_share_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 3: Competitor leaderboard (single-pass scan + single join) ───────────
-- Optimized: scan responses once for both periods, join response_competitors once.
-- Avoids double table scan that caused statement_timeout on Supabase free tier.

CREATE OR REPLACE FUNCTION get_competitor_leaderboard_rpc(
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
  competitor_name  TEXT,
  mention_count    BIGINT,
  visibility_score FLOAT,
  delta            FLOAT
) LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT id,
      (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
      (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev
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
  totals AS (
    SELECT
      COUNT(*) FILTER (WHERE is_cur)  AS cur_n,
      COUNT(*) FILTER (WHERE is_prev) AS prev_n
    FROM filtered
  ),
  comp_counts AS (
    SELECT rc.competitor_name,
      COUNT(*) FILTER (WHERE f.is_cur)  AS cur_cnt,
      COUNT(*) FILTER (WHERE f.is_prev) AS prev_cnt
    FROM filtered f
    JOIN response_competitors rc ON rc.response_id = f.id
    GROUP BY rc.competitor_name
  )
  SELECT
    c.competitor_name,
    c.cur_cnt                                                                   AS mention_count,
    CASE WHEN t.cur_n > 0 THEN c.cur_cnt::float / t.cur_n * 100 ELSE 0 END     AS visibility_score,
    CASE WHEN t.cur_n > 0 AND t.prev_n > 0 AND c.prev_cnt > 0
      THEN c.cur_cnt::float / t.cur_n * 100 - c.prev_cnt::float / t.prev_n * 100
      ELSE NULL END                                                               AS delta
  FROM comp_counts c
  CROSS JOIN totals t
  WHERE c.cur_cnt > 0
  ORDER BY visibility_score DESC
  LIMIT 20
$$;

GRANT EXECUTE ON FUNCTION get_competitor_leaderboard_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 4: Clay visibility timeseries (+ timeout) ────────────────────────────

CREATE OR REPLACE FUNCTION get_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, value FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    run_day AS date,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
      / NULLIF(COUNT(*), 0) * 100 AS value
  FROM responses
  WHERE passes_filters(
    run_day, platform, prompt_type, branded_or_non_branded, tags,
    p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
  )
  GROUP BY run_day
  ORDER BY run_day
$$;
-- Note: get_visibility_timeseries_rpc uses passes_filters() which PostgreSQL inlines
-- (LANGUAGE sql IMMUTABLE). Fast enough since it only aggregates responses (no child joins).

GRANT EXECUTE ON FUNCTION get_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 5: Competitor visibility timeseries (inline filters for index usage) ──
-- LIMIT 20 on top_competitors prevents 1000-row PostgREST hard cap from
-- truncating data when there are 400+ unique competitors × multiple days.
-- Without LIMIT 20, ORDER BY date fills the first 1000 rows with the earliest
-- day, silently dropping all later days (showed 0% for Apr 9-10).

CREATE OR REPLACE FUNCTION get_competitor_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, competitor TEXT, value FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT id, run_day FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
  ),
  totals AS (SELECT run_day, COUNT(*) AS n FROM filtered GROUP BY run_day),
  -- Limit to top 20 competitors by total mentions to stay under the
  -- PostgREST 1000-row hard cap (20 competitors × N days << 1000).
  top_competitors AS (
    SELECT rc.competitor_name
    FROM response_competitors rc
    JOIN filtered f ON f.id = rc.response_id
    GROUP BY rc.competitor_name
    ORDER BY COUNT(*) DESC
    LIMIT 20
  ),
  comp_counts AS (
    SELECT f.run_day, rc.competitor_name, COUNT(rc.response_id) AS cnt
    FROM response_competitors rc
    JOIN filtered f ON f.id = rc.response_id
    WHERE rc.competitor_name IN (SELECT competitor_name FROM top_competitors)
    GROUP BY f.run_day, rc.competitor_name
  )
  SELECT cc.run_day AS date, cc.competitor_name AS competitor, cc.cnt::float / t.n * 100 AS value
  FROM comp_counts cc
  JOIN totals t USING (run_day)
  ORDER BY date, competitor
$$;

GRANT EXECUTE ON FUNCTION get_competitor_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 6: Citation timeseries (no JOIN — uses cited_domains on responses) ────
-- Optimized: reads cited_domains TEXT[] column directly from responses.
-- Same approach as get_citation_share_kpi — eliminates JOIN to citation_domains.
-- Denominator per day = responses with any citation.
-- Numerator per day   = responses where cited_domains contains a clay.com domain.

CREATE OR REPLACE FUNCTION get_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, value FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT
      run_day,
      (cited_domains IS NOT NULL AND jsonb_array_length(cited_domains) > 0) AS has_citation,
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
      ) AS has_clay
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
  )
  SELECT
    run_day AS date,
    CASE
      WHEN COUNT(*) FILTER (WHERE has_citation) > 0
      THEN COUNT(*) FILTER (WHERE has_citation AND has_clay)::float
           / COUNT(*) FILTER (WHERE has_citation) * 100
      ELSE 0
    END AS value
  FROM filtered
  GROUP BY run_day
  ORDER BY run_day
$$;

GRANT EXECUTE ON FUNCTION get_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
