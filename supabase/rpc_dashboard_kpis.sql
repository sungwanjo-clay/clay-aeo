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


-- ── RPC 7: Citation count KPI (raw clay-cited response count, both periods) ───
-- Replaces getCitationCount() which did two parallel paginated fetches of responses.
-- Single-pass scan: reads cited_domains JSONB column directly, no child table join.

CREATE OR REPLACE FUNCTION get_citation_count_kpi(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prev_start_day DATE,
  p_prev_end_day   DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(current_count BIGINT, previous_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT
      (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
      (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
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
  )
  SELECT
    COUNT(*) FILTER (WHERE is_cur  AND has_clay) AS current_count,
    COUNT(*) FILTER (WHERE is_prev AND has_clay) AS previous_count
  FROM filtered
$$;

GRANT EXECUTE ON FUNCTION get_citation_count_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 8: Clay KPIs (visibility, citation rate, avg position, top topic/platform) ─
-- Replaces getClayKPIs() which did two parallel paginated fetches (current + previous).
-- Single-pass scan covers both periods; cited_domains JSONB read inline (no child join).

CREATE OR REPLACE FUNCTION get_clay_kpis_rpc(
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
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
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
      COUNT(*) FILTER (WHERE is_cur)                                              AS cur_n,
      COUNT(*) FILTER (WHERE is_cur  AND clay_mentioned ILIKE 'yes')              AS cur_mentioned,
      COUNT(*) FILTER (WHERE is_prev)                                             AS prev_n,
      COUNT(*) FILTER (WHERE is_prev AND clay_mentioned ILIKE 'yes')              AS prev_mentioned,
      COUNT(*) FILTER (WHERE is_cur  AND has_citation)                            AS cur_cited_n,
      COUNT(*) FILTER (WHERE is_cur  AND has_citation AND has_clay)               AS cur_clay_cited,
      COUNT(*) FILTER (WHERE is_prev AND has_citation)                            AS prev_cited_n,
      COUNT(*) FILTER (WHERE is_prev AND has_citation AND has_clay)               AS prev_clay_cited,
      AVG(clay_mention_position)
        FILTER (WHERE is_cur AND clay_mentioned ILIKE 'yes'
                AND clay_mention_position IS NOT NULL)                            AS avg_pos
    FROM filtered
  ),
  top_topic AS (
    SELECT topic
    FROM filtered
    WHERE is_cur AND clay_mentioned ILIKE 'yes' AND topic IS NOT NULL
    GROUP BY topic ORDER BY COUNT(*) DESC LIMIT 1
  ),
  top_platform AS (
    SELECT platform
    FROM filtered
    WHERE is_cur AND clay_mentioned ILIKE 'yes' AND platform IS NOT NULL
    GROUP BY platform ORDER BY COUNT(*) DESC LIMIT 1
  )
  SELECT
    CASE WHEN a.cur_n        > 0 THEN a.cur_mentioned::float   / a.cur_n        * 100 ELSE NULL END,
    CASE WHEN a.prev_n       > 0 THEN a.prev_mentioned::float  / a.prev_n       * 100 ELSE NULL END,
    CASE WHEN a.cur_cited_n  > 0 THEN a.cur_clay_cited::float  / a.cur_cited_n  * 100 ELSE NULL END,
    CASE WHEN a.prev_cited_n > 0 THEN a.prev_clay_cited::float / a.prev_cited_n * 100 ELSE NULL END,
    a.avg_pos,
    a.cur_mentioned,
    tt.topic,
    tp.platform
  FROM agg a
  LEFT JOIN top_topic   tt ON true
  LEFT JOIN top_platform tp ON true
$$;

GRANT EXECUTE ON FUNCTION get_clay_kpis_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 9: PMM table (per-pmm_use_case + pmm_classification KPIs + daily timeseries, both periods) ─
-- Returns one row per (pmm_use_case, pmm_classification); timeseries is a JSONB array [{date,value}].
-- citation_share denominator = total responses for the use-case × classification combo.

CREATE OR REPLACE FUNCTION get_pmm_table_rpc(
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
  pmm_use_case        TEXT,
  pmm_classification  TEXT,
  visibility_score    FLOAT,
  delta               FLOAT,
  citation_share      FLOAT,
  avg_position        FLOAT,
  total_responses     BIGINT,
  timeseries          JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT
      (run_day BETWEEN p_start_day AND p_end_day)           AS is_cur,
      (run_day BETWEEN p_prev_start_day AND p_prev_end_day) AS is_prev,
      run_day,
      pmm_use_case,
      pmm_classification,
      clay_mentioned,
      clay_mention_position::float,
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(cited_domains) d WHERE d ILIKE '%clay%'
      ) AS has_clay
    FROM responses
    WHERE run_day BETWEEN LEAST(p_start_day, p_prev_start_day)
                      AND GREATEST(p_end_day, p_prev_end_day)
      AND pmm_use_case IS NOT NULL
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
      AND (run_day BETWEEN p_start_day AND p_end_day
           OR run_day BETWEEN p_prev_start_day AND p_prev_end_day)
  ),
  cur_by_pmm AS (
    SELECT
      pmm_use_case,
      pmm_classification,
      COUNT(*)                                                          AS total,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')               AS mentioned,
      COUNT(*) FILTER (WHERE has_clay)                                  AS clay_cited,
      AVG(clay_mention_position)
        FILTER (WHERE clay_mentioned ILIKE 'yes'
                AND clay_mention_position IS NOT NULL)                  AS avg_pos
    FROM filtered
    WHERE is_cur
    GROUP BY pmm_use_case, pmm_classification
  ),
  prev_by_pmm AS (
    SELECT
      pmm_use_case,
      pmm_classification,
      COUNT(*)                                                          AS total,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')               AS mentioned
    FROM filtered
    WHERE is_prev
    GROUP BY pmm_use_case, pmm_classification
  ),
  ts_by_day AS (
    SELECT
      pmm_use_case,
      pmm_classification,
      run_day,
      COUNT(*)                                                          AS total,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')               AS mentioned
    FROM filtered
    WHERE is_cur
    GROUP BY pmm_use_case, pmm_classification, run_day
  ),
  ts_agg AS (
    SELECT
      pmm_use_case,
      pmm_classification,
      jsonb_agg(
        jsonb_build_object(
          'date',  run_day::text,
          'value', CASE WHEN total > 0 THEN mentioned::float / total * 100 ELSE 0 END
        ) ORDER BY run_day
      ) AS timeseries
    FROM ts_by_day
    GROUP BY pmm_use_case, pmm_classification
  )
  SELECT
    c.pmm_use_case,
    c.pmm_classification,
    CASE WHEN c.total > 0 THEN c.mentioned::float / c.total * 100 ELSE 0 END       AS visibility_score,
    CASE
      WHEN c.total > 0 AND p.total > 0
      THEN c.mentioned::float / c.total * 100 - p.mentioned::float / p.total * 100
      ELSE NULL
    END                                                                              AS delta,
    CASE WHEN c.total > 0 THEN c.clay_cited::float / c.total * 100 ELSE NULL END   AS citation_share,
    c.avg_pos                                                                        AS avg_position,
    c.total                                                                          AS total_responses,
    COALESCE(t.timeseries, '[]'::jsonb)                                             AS timeseries
  FROM cur_by_pmm c
  LEFT JOIN prev_by_pmm p USING (pmm_use_case, pmm_classification)
  LEFT JOIN ts_agg      t USING (pmm_use_case, pmm_classification)
  ORDER BY c.pmm_use_case, visibility_score DESC
$$;

GRANT EXECUTE ON FUNCTION get_pmm_table_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── Shared filter macro (inline in every RPC below) ──────────────────────────
-- WHERE run_day BETWEEN p_start_day AND p_end_day
--   AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
--   AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
--   AND (p_branded_filter = 'all'
--        OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
--        OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
--   AND (p_tags = 'all' OR tags = p_tags)


-- ── RPC 10: Visibility by topic timeseries ───────────────────────────────────
-- Replaces getVisibilityByTopic() paginated fetch.

CREATE OR REPLACE FUNCTION get_visibility_by_topic_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, topic TEXT, value FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    run_day AS date,
    COALESCE(topic, 'Unknown') AS topic,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
      / NULLIF(COUNT(*), 0) * 100 AS value
  FROM responses
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
    AND (p_branded_filter = 'all'
         OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
         OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
    AND (p_tags = 'all' OR tags = p_tags)
  GROUP BY run_day, topic
  ORDER BY run_day, topic
$$;

GRANT EXECUTE ON FUNCTION get_visibility_by_topic_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 11: Visibility by PMM use-case timeseries ────────────────────────────
-- Replaces getVisibilityByPMM() paginated fetch.

CREATE OR REPLACE FUNCTION get_visibility_by_pmm_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, pmm_use_case TEXT, value FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    run_day AS date,
    pmm_use_case,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
      / NULLIF(COUNT(*), 0) * 100 AS value
  FROM responses
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND pmm_use_case IS NOT NULL
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
    AND (p_branded_filter = 'all'
         OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
         OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
    AND (p_tags = 'all' OR tags = p_tags)
  GROUP BY run_day, pmm_use_case
  ORDER BY run_day, pmm_use_case
$$;

GRANT EXECUTE ON FUNCTION get_visibility_by_pmm_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 12: Claygent daily count timeseries ──────────────────────────────────
-- Replaces getClaygentTimeseries() paginated fetch.

CREATE OR REPLACE FUNCTION get_claygent_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    run_day AS date,
    COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes') AS count
  FROM responses
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
    AND (p_branded_filter = 'all'
         OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
         OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
    AND (p_tags = 'all' OR tags = p_tags)
  GROUP BY run_day
  ORDER BY run_day
$$;

GRANT EXECUTE ON FUNCTION get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 13: Claygent count timeseries by platform ────────────────────────────
-- Replaces getClaygentTimeseriesByPlatform() paginated fetch.

CREATE OR REPLACE FUNCTION get_claygent_platform_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, platform TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    run_day AS date,
    platform,
    COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes') AS count
  FROM responses
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
    AND (p_branded_filter = 'all'
         OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
         OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
    AND (p_tags = 'all' OR tags = p_tags)
  GROUP BY run_day, platform
  ORDER BY run_day, platform
$$;

GRANT EXECUTE ON FUNCTION get_claygent_platform_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 14: Share of voice (competitor mention share) ────────────────────────
-- Replaces getShareOfVoice() which did paginated responses + batched response_competitors.
-- sov_pct = competitor's mention rows / total mention rows across all competitors.
-- LIMIT 50: prevents PostgREST 1000-row cap; chart shows top 10-20 anyway.

CREATE OR REPLACE FUNCTION get_share_of_voice_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(competitor_name TEXT, mention_count BIGINT, sov_pct FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT id FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
  ),
  rc_counts AS (
    SELECT rc.competitor_name, COUNT(*) AS cnt
    FROM response_competitors rc
    JOIN filtered f ON f.id = rc.response_id
    WHERE rc.competitor_name IS NOT NULL
    GROUP BY rc.competitor_name
  ),
  total AS (SELECT SUM(cnt)::float AS n FROM rc_counts)
  SELECT
    rc.competitor_name,
    rc.cnt AS mention_count,
    CASE WHEN t.n > 0 THEN rc.cnt::float / t.n * 100 ELSE 0 END AS sov_pct
  FROM rc_counts rc
  CROSS JOIN total t
  ORDER BY rc.cnt DESC
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION get_share_of_voice_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 15: Sentiment breakdown KPI ──────────────────────────────────────────
-- Replaces getSentimentBreakdown() paginated fetch. Single pass, no child joins.

CREATE OR REPLACE FUNCTION get_sentiment_breakdown_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  total_count      BIGINT,
  mentioned_count  BIGINT,
  positive_count   BIGINT,
  neutral_count    BIGINT,
  negative_count   BIGINT,
  avg_score        FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    COUNT(*)                                                                          AS total_count,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')                               AS mentioned_count,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Positive') AS positive_count,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Neutral')  AS neutral_count,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Negative') AS negative_count,
    AVG(brand_sentiment_score::float)
      FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment_score IS NOT NULL) AS avg_score
  FROM responses
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
    AND (p_branded_filter = 'all'
         OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
         OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
    AND (p_tags = 'all' OR tags = p_tags)
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_breakdown_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 16: Sentiment timeseries (daily pos/neu/neg breakdown) ───────────────
-- Replaces getSentimentTimeseries() paginated fetch.

CREATE OR REPLACE FUNCTION get_sentiment_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, positive FLOAT, neutral FLOAT, negative FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  SELECT
    run_day AS date,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Positive')::float
      / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100 AS positive,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Neutral')::float
      / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100 AS neutral,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Negative')::float
      / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100 AS negative
  FROM responses
  WHERE run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
    AND (p_branded_filter = 'all'
         OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
         OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
    AND (p_tags = 'all' OR tags = p_tags)
  GROUP BY run_day
  ORDER BY run_day
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 17: Use-case attribution ─────────────────────────────────────────────
-- Replaces getUseCaseAttribution() paginated fetch.
-- mode() WITHIN GROUP returns the most frequent value per use-case.

CREATE OR REPLACE FUNCTION get_use_case_attribution_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(
  use_case     TEXT,
  count        BIGINT,
  pct          FLOAT,
  top_platform TEXT,
  top_topic    TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH mentioned AS MATERIALIZED (
    SELECT primary_use_case_attributed, platform, topic
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND clay_mentioned ILIKE 'yes'
      AND primary_use_case_attributed IS NOT NULL
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
  ),
  total AS (SELECT COUNT(*)::float AS n FROM mentioned)
  SELECT
    primary_use_case_attributed AS use_case,
    COUNT(*) AS count,
    CASE WHEN t.n > 0 THEN COUNT(*)::float / t.n * 100 ELSE 0 END AS pct,
    mode() WITHIN GROUP (ORDER BY platform) AS top_platform,
    mode() WITHIN GROUP (ORDER BY topic)    AS top_topic
  FROM mentioned
  CROSS JOIN total t
  GROUP BY primary_use_case_attributed, t.n
  ORDER BY count DESC
$$;

GRANT EXECUTE ON FUNCTION get_use_case_attribution_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 18: Competitor citation timeseries ───────────────────────────────────
-- Replaces getCompetitorCitationTimeseries() which did paginated responses
-- + hundreds of batched citation_domains requests.
-- Returns top p_top_n competitor domains (citation_type='Competition') + clay.com,
-- per day, as share of cited responses.

CREATE OR REPLACE FUNCTION get_competitor_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_top_n          INT     DEFAULT 5
)
RETURNS TABLE(date DATE, domain TEXT, value FLOAT)
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
  -- Join citation_domains once; normalise clay.com variants
  cited AS (
    SELECT
      f.run_day,
      f.id AS response_id,
      CASE WHEN LOWER(cd.domain) LIKE '%clay.com%' THEN 'clay.com'
           ELSE LOWER(cd.domain) END AS domain,
      cd.citation_type
    FROM citation_domains cd
    JOIN filtered f ON f.id = cd.response_id
    WHERE cd.domain IS NOT NULL
  ),
  -- Denominator: unique responses with any citation per day
  daily_totals AS (
    SELECT run_day, COUNT(DISTINCT response_id) AS total_cited
    FROM cited
    GROUP BY run_day
  ),
  -- Top N competitor domains by unique citing responses across all days
  top_competitors AS (
    SELECT domain
    FROM cited
    WHERE citation_type = 'Competition' AND domain NOT LIKE '%clay%'
    GROUP BY domain
    ORDER BY COUNT(DISTINCT response_id) DESC
    LIMIT p_top_n
  ),
  -- Relevant domains = top competitors + clay.com
  relevant AS (
    SELECT domain FROM top_competitors
    UNION
    SELECT 'clay.com'
  ),
  -- Per-day per-domain unique citing response count
  domain_day AS (
    SELECT run_day, domain, COUNT(DISTINCT response_id) AS cnt
    FROM cited
    WHERE domain IN (SELECT domain FROM relevant)
    GROUP BY run_day, domain
  )
  SELECT
    dd.run_day AS date,
    dd.domain,
    CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END AS value
  FROM domain_day dd
  JOIN daily_totals dt USING (run_day)
  ORDER BY dd.run_day, dd.domain
$$;

GRANT EXECUTE ON FUNCTION get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT)
  TO anon, authenticated;


-- ── RPC 19: Top cited domains with URLs ──────────────────────────────────────
-- Replaces getTopCitedDomainsWithURLs() which did paginated responses
-- + hundreds of batched citation_domains requests.
-- Returns top 20 domains by unique citing responses; top_urls is JSONB [{url,title,count}].
-- share_pct denominator = unique responses with any citation (matches line chart).

CREATE OR REPLACE FUNCTION get_top_cited_domains_rpc(
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
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT id FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
  ),
  citations AS (
    SELECT
      LOWER(cd.domain)    AS domain,
      cd.url,
      cd.title,
      cd.citation_type,
      cd.response_id
    FROM citation_domains cd
    JOIN filtered f ON f.id = cd.response_id
    WHERE cd.domain IS NOT NULL
  ),
  -- Total unique cited responses (denominator for share_pct)
  total_cited AS (
    SELECT COUNT(DISTINCT response_id)::float AS n FROM citations
  ),
  -- Per-domain aggregates
  domain_stats AS (
    SELECT
      domain,
      COUNT(DISTINCT response_id)                AS response_count,
      BOOL_OR(domain LIKE '%clay.com%')          AS is_clay,
      mode() WITHIN GROUP (ORDER BY citation_type) AS citation_type
    FROM citations
    GROUP BY domain
  ),
  -- Per-domain per-url counts, ranked
  url_ranked AS (
    SELECT
      domain,
      url,
      MAX(title) AS title,
      COUNT(*)   AS cnt,
      ROW_NUMBER() OVER (PARTITION BY domain ORDER BY COUNT(*) DESC) AS rn
    FROM citations
    WHERE url IS NOT NULL
    GROUP BY domain, url
  ),
  -- Aggregate top 8 URLs per domain into JSONB
  top_urls AS (
    SELECT
      domain,
      jsonb_agg(
        jsonb_build_object('url', url, 'title', title, 'count', cnt)
        ORDER BY cnt DESC
      ) AS top_urls
    FROM url_ranked
    WHERE rn <= 8
    GROUP BY domain
  )
  SELECT
    ds.domain,
    ds.response_count                                                              AS citation_count,
    CASE WHEN tc.n > 0 THEN ds.response_count::float / tc.n * 100 ELSE 0 END     AS share_pct,
    ds.is_clay,
    ds.citation_type,
    COALESCE(tu.top_urls, '[]'::jsonb)                                            AS top_urls
  FROM domain_stats ds
  CROSS JOIN total_cited tc
  LEFT JOIN top_urls tu USING (domain)
  ORDER BY ds.response_count DESC
  LIMIT 20
$$;

GRANT EXECUTE ON FUNCTION get_top_cited_domains_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
