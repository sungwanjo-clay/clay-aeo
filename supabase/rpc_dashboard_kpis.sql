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
  p_platforms            TEXT[], -- empty array = all platforms
  p_branded_filter       TEXT,   -- 'all' | 'branded' | 'non-branded'
  p_tags                 TEXT    -- 'all' or specific tag
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT
    r_run_day BETWEEN p_start_day AND p_end_day
    AND (p_prompt_type = 'all'  OR r_prompt_type ILIKE p_prompt_type)
    AND (array_length(p_platforms, 1) IS NULL OR r_platform = ANY(p_platforms))
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
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
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


-- ── RPC 2: Citation share ────────────────────────────────────
-- NOTE: Uses RETURNS TABLE (not JSON) so Supabase JS returns data[0].field correctly.

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
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH cur AS (
    SELECT id FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
  ),
  prev AS (
    SELECT id FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_prev_start_day, p_prev_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
  ),
  cur_cit AS (
    SELECT
      COUNT(DISTINCT response_id) AS any_cited,
      COUNT(DISTINCT response_id) FILTER (WHERE domain ILIKE '%clay%') AS clay_cited
    FROM citation_domains WHERE response_id IN (SELECT id FROM cur)
  ),
  prev_cit AS (
    SELECT
      COUNT(DISTINCT response_id) AS any_cited,
      COUNT(DISTINCT response_id) FILTER (WHERE domain ILIKE '%clay%') AS clay_cited
    FROM citation_domains WHERE response_id IN (SELECT id FROM prev)
  )
  SELECT
    CASE WHEN c.any_cited > 0 THEN c.clay_cited::float / c.any_cited * 100 ELSE NULL END,
    CASE WHEN p.any_cited > 0 THEN p.clay_cited::float / p.any_cited * 100 ELSE NULL END
  FROM cur_cit c, prev_cit p
$$;

GRANT EXECUTE ON FUNCTION get_citation_share_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 3: Competitor leaderboard ───────────────────────────

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
  competitor_name TEXT,
  mention_count   BIGINT,
  visibility_score FLOAT,
  delta           FLOAT
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH cur_ids AS (
    SELECT id FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
  ),
  prev_ids AS (
    SELECT id FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_prev_start_day, p_prev_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
  ),
  cur_total  AS (SELECT COUNT(*) AS n FROM cur_ids),
  prev_total AS (SELECT COUNT(*) AS n FROM prev_ids),
  cur_counts AS (
    SELECT rc.competitor_name, COUNT(DISTINCT rc.response_id) AS cnt
    FROM response_competitors rc
    WHERE rc.response_id IN (SELECT id FROM cur_ids)
    GROUP BY rc.competitor_name
  ),
  prev_counts AS (
    SELECT rc.competitor_name, COUNT(DISTINCT rc.response_id) AS cnt
    FROM response_competitors rc
    WHERE rc.response_id IN (SELECT id FROM prev_ids)
    GROUP BY rc.competitor_name
  )
  SELECT
    c.competitor_name,
    c.cnt                                                                AS mention_count,
    CASE WHEN t.n > 0 THEN c.cnt::float / t.n * 100 ELSE 0 END         AS visibility_score,
    CASE WHEN pt.n > 0 AND p.cnt IS NOT NULL
      THEN c.cnt::float / t.n * 100 - p.cnt::float / pt.n * 100
      ELSE NULL
    END                                                                  AS delta
  FROM cur_counts c
  CROSS JOIN cur_total t
  LEFT JOIN prev_counts p USING (competitor_name)
  CROSS JOIN prev_total pt
  ORDER BY visibility_score DESC
$$;

GRANT EXECUTE ON FUNCTION get_competitor_leaderboard_rpc(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 4: Clay visibility timeseries ───────────────────────

CREATE OR REPLACE FUNCTION get_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, value FLOAT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    run_day                                                               AS date,
    COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
      / NULLIF(COUNT(*), 0) * 100                                        AS value
  FROM responses
  WHERE passes_filters(
    run_day, platform, prompt_type, branded_or_non_branded, tags,
    p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
  )
  GROUP BY run_day
  ORDER BY run_day
$$;

GRANT EXECUTE ON FUNCTION get_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 5: Competitor visibility timeseries ──────────────────

CREATE OR REPLACE FUNCTION get_competitor_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, competitor TEXT, value FLOAT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH filtered AS (
    SELECT id, run_day FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
  ),
  totals AS (
    SELECT run_day, COUNT(*) AS n FROM filtered GROUP BY run_day
  ),
  comp_counts AS (
    SELECT f.run_day, rc.competitor_name, COUNT(DISTINCT rc.response_id) AS cnt
    FROM response_competitors rc
    JOIN filtered f ON f.id = rc.response_id
    GROUP BY f.run_day, rc.competitor_name
  )
  SELECT
    cc.run_day            AS date,
    cc.competitor_name    AS competitor,
    cc.cnt::float / t.n * 100 AS value
  FROM comp_counts cc
  JOIN totals t USING (run_day)
  ORDER BY date, competitor
$$;

GRANT EXECUTE ON FUNCTION get_competitor_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 6: Citation timeseries (clay share per day) ──────────

CREATE OR REPLACE FUNCTION get_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, value FLOAT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH filtered AS (
    SELECT id, run_day FROM responses
    WHERE passes_filters(
      run_day, platform, prompt_type, branded_or_non_branded, tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
  ),
  by_day AS (
    SELECT
      f.run_day,
      COUNT(DISTINCT cd.response_id)
        FILTER (WHERE cd.domain ILIKE '%clay%')  AS clay_cited,
      COUNT(DISTINCT cd.response_id)              AS any_cited
    FROM citation_domains cd
    JOIN filtered f ON f.id = cd.response_id
    GROUP BY f.run_day
  )
  SELECT
    run_day AS date,
    CASE WHEN any_cited > 0 THEN clay_cited::float / any_cited * 100 ELSE 0 END AS value
  FROM by_day
  ORDER BY run_day
$$;

GRANT EXECUTE ON FUNCTION get_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
