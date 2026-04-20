-- ============================================================
-- Metric Explorer RPCs
-- Run in Supabase SQL Editor to create/replace both functions.
-- ============================================================

-- ── 1. Distinct dimension values ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_explorer_dimension_values(p_dimension TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result TEXT[];
BEGIN
  -- Validate column name to prevent SQL injection
  IF p_dimension NOT IN (
    'platform','topic','intent','pmm_classification',
    'branded_or_non_branded','prompt_type','tags'
  ) THEN
    RAISE EXCEPTION 'Invalid dimension: %', p_dimension;
  END IF;

  EXECUTE format(
    'SELECT ARRAY(SELECT DISTINCT %I FROM responses WHERE %I IS NOT NULL ORDER BY 1)',
    p_dimension, p_dimension
  ) INTO result;

  RETURN COALESCE(result, ARRAY[]::TEXT[]);
END;
$$;


-- ── 2. Aggregated explorer data ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_explorer_data(
  p_metric           TEXT,
  p_dimension        TEXT,
  p_start_date       DATE,
  p_end_date         DATE,
  p_aggregation      TEXT,              -- 'day' | 'week' | 'month'
  p_dimension_values TEXT[] DEFAULT NULL
)
RETURNS TABLE(period TEXT, dimension_value TEXT, value FLOAT8, response_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  period_expr TEXT;
  metric_expr TEXT;
  dim_filter  TEXT := '';
BEGIN
  -- Validate inputs
  IF p_dimension NOT IN (
    'platform','topic','intent','pmm_classification',
    'branded_or_non_branded','prompt_type','tags'
  ) THEN
    RAISE EXCEPTION 'Invalid dimension: %', p_dimension;
  END IF;

  IF p_metric NOT IN (
    'visibility_score','mention_share','citation_share','avg_position',
    'positive_sentiment_pct','brand_sentiment_score','response_quality_score',
    'competitor_count','tools_recommended','claygent_mcp_rate','avg_credits'
  ) THEN
    RAISE EXCEPTION 'Invalid metric: %', p_metric;
  END IF;

  -- Period bucketing
  period_expr := CASE p_aggregation
    WHEN 'week'  THEN 'TO_CHAR(DATE_TRUNC(''week'', run_day::TIMESTAMP), ''YYYY-MM-DD'')'
    WHEN 'month' THEN 'TO_CHAR(run_day, ''YYYY-MM'')'
    ELSE              'TO_CHAR(run_day, ''YYYY-MM-DD'')'
  END;

  -- Metric SQL expression
  metric_expr := CASE p_metric
    WHEN 'visibility_score', 'mention_share' THEN
      'COUNT(*) FILTER (WHERE LOWER(clay_mentioned) = ''yes'') * 100.0 / NULLIF(COUNT(*), 0)'

    WHEN 'citation_share' THEN
      $m$COUNT(*) FILTER (
        WHERE cited_domains IS NOT NULL
          AND cited_domains::TEXT NOT IN ('null','[]','')
          AND jsonb_array_length(CASE WHEN jsonb_typeof(cited_domains) = 'array'
                                      THEN cited_domains ELSE '[]'::jsonb END) > 0
      ) * 100.0 / NULLIF(COUNT(*), 0)$m$

    WHEN 'avg_position' THEN
      'AVG(clay_mention_position) FILTER (WHERE LOWER(clay_mentioned) = ''yes'' AND clay_mention_position > 0)'

    WHEN 'positive_sentiment_pct' THEN
      $m$COUNT(*) FILTER (WHERE LOWER(clay_mentioned) = 'yes' AND brand_sentiment = 'Positive') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE LOWER(clay_mentioned) = 'yes'), 0)$m$

    WHEN 'brand_sentiment_score', 'response_quality_score' THEN
      'AVG(brand_sentiment_score)'

    WHEN 'competitor_count' THEN
      $m$AVG(
        jsonb_array_length(
          CASE WHEN competitors_mentioned IS NULL            THEN '[]'::jsonb
               WHEN jsonb_typeof(competitors_mentioned) = 'array' THEN competitors_mentioned
               ELSE '[]'::jsonb END
        )
      )$m$

    WHEN 'tools_recommended' THEN
      'AVG(number_of_tools_recommended)'

    WHEN 'claygent_mcp_rate' THEN
      'COUNT(*) FILTER (WHERE LOWER(claygent_or_mcp_mentioned) = ''yes'') * 100.0 / NULLIF(COUNT(*), 0)'

    WHEN 'avg_credits' THEN
      'AVG(total_credits_charged)'

    ELSE 'NULL::FLOAT8'
  END;

  -- Optional dimension value filter
  IF p_dimension_values IS NOT NULL AND array_length(p_dimension_values, 1) > 0 THEN
    dim_filter := format('AND %I = ANY(%L::TEXT[])', p_dimension, p_dimension_values);
  END IF;

  RETURN QUERY EXECUTE format(
    $sql$
      SELECT
        (%s)         AS period,
        COALESCE(%I::TEXT, 'Unknown') AS dimension_value,
        (%s)::FLOAT8 AS value,
        COUNT(*)::BIGINT AS response_count
      FROM responses
      WHERE run_day BETWEEN %L::DATE AND %L::DATE
        %s
      GROUP BY 1, 2
      ORDER BY 1, 2
    $sql$,
    period_expr,
    p_dimension,
    metric_expr,
    p_start_date,
    p_end_date,
    dim_filter
  );
END;
$$;
