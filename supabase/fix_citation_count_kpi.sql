-- Fix get_citation_count_kpi: numeric→bigint type mismatch
-- SUM(bigint) in plpgsql returns numeric; RETURNS TABLE expects BIGINT

DROP FUNCTION IF EXISTS get_citation_count_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_citation_count_kpi(
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
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
DECLARE
  v_prev_start DATE := COALESCE(p_prev_start_day, p_start_day);
  v_prev_end   DATE := COALESCE(p_prev_end_day,   p_end_day);
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      COALESCE(SUM(d.clay_cited_responses) FILTER (WHERE d.run_day BETWEEN p_start_day AND p_end_day),    0)::BIGINT,
      COALESCE(SUM(d.clay_cited_responses) FILTER (WHERE d.run_day BETWEEN v_prev_start AND v_prev_end),  0)::BIGINT
    FROM aeo_cache_daily d
    WHERE d.run_day BETWEEN LEAST(p_start_day, v_prev_start)
                        AND GREATEST(p_end_day, v_prev_end)
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type);
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT r.run_day,
        (r.run_day BETWEEN p_start_day AND p_end_day)    AS is_cur,
        (r.run_day BETWEEN v_prev_start AND v_prev_end)   AS is_prev,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(r.cited_domains) d WHERE d ILIKE '%clay%'
        ) AS has_clay
      FROM responses r
      WHERE r.run_day BETWEEN LEAST(p_start_day, v_prev_start)
                          AND GREATEST(p_end_day, v_prev_end)
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
        AND (r.run_day BETWEEN p_start_day AND p_end_day
             OR r.run_day BETWEEN v_prev_start AND v_prev_end)
    )
    SELECT
      COUNT(*) FILTER (WHERE is_cur  AND has_clay)::BIGINT,
      COUNT(*) FILTER (WHERE is_prev AND has_clay)::BIGINT
    FROM filtered;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_citation_count_kpi(DATE,DATE,DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
