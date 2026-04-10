-- ============================================================
-- add_followup_rpc.sql
-- Cache-backed followup timeseries RPC (replaces direct table scan)
-- aeo_cache_daily already has clay_followup column populated
-- ============================================================

DROP FUNCTION IF EXISTS get_followup_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_followup_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all'
)
RETURNS TABLE(date DATE, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- Fast path: pre-aggregated cache (instant)
    RETURN QUERY
    SELECT
      d.run_day,
      SUM(d.clay_followup)::BIGINT
    FROM aeo_cache_daily d
    WHERE d.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
    GROUP BY d.run_day
    ORDER BY d.run_day;
  ELSE
    -- Slow path: live scan
    RETURN QUERY
    SELECT
      r.run_day,
      COUNT(*) FILTER (WHERE r.clay_recommended_followup ILIKE 'yes')::BIGINT
    FROM responses r
    WHERE r.run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
           OR r.platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR r.tags = p_tags)
    GROUP BY r.run_day
    ORDER BY r.run_day;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_followup_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
