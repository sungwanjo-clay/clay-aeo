-- ============================================================
-- Weekly-granularity option for the dashboard's timeseries RPCs
--
-- Context: the Clay → Supabase job runs weekly as of 2026-10-31, and each
-- batch straddles UTC midnight. Rows land on two consecutive run_days with
-- a non-random platform split (ChatGPT first → low Clay rate, Claude +
-- Branded second → high Clay rate), so the daily lines on the dashboard
-- show pairs of dots with a spike on the second day of each week.
--
-- This migration adds a trailing `p_granularity TEXT DEFAULT 'daily'`
-- parameter to the seven timeseries RPCs that drive the dashboard. When
-- 'weekly', we group by date_trunc('week', run_day)::date (Monday-start
-- ISO week), so both days of a batch collapse into one point per week
-- with a weighted average (sum numerator / sum denominator across the
-- week) — NOT an average-of-averages, which would double-weight the
-- tiny tail day.
--
-- Default remains 'daily' so any caller that doesn't pass the arg keeps
-- today's behavior.
--
-- Postgres treats a new default-arg as a different function signature,
-- so without dropping the previous 6-arg version both live side-by-side
-- and PostgREST errors with PGRST203 ("Could not choose the best
-- candidate function"). Explicit DROPs below remove the old overloads.
-- ============================================================

DROP FUNCTION IF EXISTS get_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_competitor_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT);
DROP FUNCTION IF EXISTS get_sentiment_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_claygent_platform_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);
DROP FUNCTION IF EXISTS get_followup_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);


-- ── RPC 1: Clay visibility timeseries ───────────────────────────────
CREATE OR REPLACE FUNCTION get_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      SUM(clay_mentioned)::float / NULLIF(SUM(total_responses), 0) * 100
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY bucket
    ORDER BY bucket;
  ELSE
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', r.run_day)::date
           ELSE r.run_day END AS bucket,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes')::float
        / NULLIF(COUNT(*), 0) * 100
    FROM responses r
    WHERE passes_filters(
      r.run_day, r.platform, r.prompt_type, r.branded_or_non_branded, r.tags,
      p_start_day, p_end_day, p_prompt_type, p_platforms, p_branded_filter, p_tags
    )
    GROUP BY bucket
    ORDER BY bucket;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 2: Competitor visibility timeseries ─────────────────────────
CREATE OR REPLACE FUNCTION get_competitor_visibility_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, competitor TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH buckets AS (
      SELECT run_day,
             CASE WHEN p_granularity = 'weekly'
                  THEN date_trunc('week', run_day)::date
                  ELSE run_day END AS bucket
      FROM generate_series(p_start_day, p_end_day, '1 day'::interval) AS g(run_day)
    ),
    totals AS (
      SELECT b.bucket, SUM(c.total_responses) AS n
      FROM aeo_cache_daily c
      JOIN buckets b USING (run_day)
      WHERE c.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR c.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR c.prompt_type ILIKE p_prompt_type)
      GROUP BY b.bucket
    ),
    top_comp AS (
      SELECT competitor_name
      FROM aeo_cache_competitors
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY competitor_name
      ORDER BY SUM(mention_count) DESC
      LIMIT 20
    ),
    comp_daily AS (
      SELECT b.bucket, c.competitor_name, SUM(c.mention_count) AS cnt
      FROM aeo_cache_competitors c
      JOIN buckets b USING (run_day)
      WHERE c.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR c.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR c.prompt_type ILIKE p_prompt_type)
        AND c.competitor_name IN (SELECT competitor_name FROM top_comp)
      GROUP BY b.bucket, c.competitor_name
    )
    SELECT cd.bucket, cd.competitor_name, cd.cnt::float / t.n * 100
    FROM comp_daily cd
    JOIN totals t USING (bucket)
    ORDER BY cd.bucket, cd.competitor_name;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id,
             CASE WHEN p_granularity = 'weekly'
                  THEN date_trunc('week', run_day)::date
                  ELSE run_day END AS bucket
      FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    totals AS (SELECT bucket, COUNT(*) AS n FROM filtered GROUP BY bucket),
    top_competitors AS (
      SELECT rc.competitor_name
      FROM response_competitors rc
      JOIN filtered f ON f.id = rc.response_id
      GROUP BY rc.competitor_name
      ORDER BY COUNT(*) DESC
      LIMIT 20
    ),
    comp_counts AS (
      SELECT f.bucket, rc.competitor_name, COUNT(rc.response_id) AS cnt
      FROM response_competitors rc
      JOIN filtered f ON f.id = rc.response_id
      WHERE rc.competitor_name IN (SELECT competitor_name FROM top_competitors)
      GROUP BY f.bucket, rc.competitor_name
    )
    SELECT cc.bucket, cc.competitor_name, cc.cnt::float / t.n * 100
    FROM comp_counts cc
    JOIN totals t USING (bucket)
    ORDER BY cc.bucket, cc.competitor_name;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_visibility_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 3: Citation share timeseries ────────────────────────────────
CREATE OR REPLACE FUNCTION get_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      CASE
        WHEN SUM(total_with_citations) > 0
        THEN SUM(clay_cited_responses)::float / SUM(total_with_citations) * 100
        ELSE 0::float
      END
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY bucket
    ORDER BY bucket;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        CASE WHEN p_granularity = 'weekly'
             THEN date_trunc('week', run_day)::date
             ELSE run_day END AS bucket,
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
      bucket,
      CASE
        WHEN COUNT(*) FILTER (WHERE has_citation) > 0
        THEN COUNT(*) FILTER (WHERE has_citation AND has_clay)::float
             / COUNT(*) FILTER (WHERE has_citation) * 100
        ELSE 0
      END
    FROM filtered
    GROUP BY bucket
    ORDER BY bucket;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 4: Competitor citation share timeseries ─────────────────────
CREATE OR REPLACE FUNCTION get_competitor_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_top_n          INT     DEFAULT 5,
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, domain TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH daily_totals AS (
      SELECT
        CASE WHEN p_granularity = 'weekly'
             THEN date_trunc('week', run_day)::date
             ELSE run_day END AS bucket,
        SUM(response_count) AS total_cited
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      GROUP BY bucket
    ),
    top_competitors AS (
      SELECT domain
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND citation_type = 'Competition'
        AND domain NOT LIKE '%clay%'
      GROUP BY domain
      ORDER BY SUM(response_count) DESC
      LIMIT p_top_n
    ),
    relevant AS (
      SELECT domain FROM top_competitors
      UNION SELECT 'clay.com'
    ),
    domain_day AS (
      SELECT
        CASE WHEN p_granularity = 'weekly'
             THEN date_trunc('week', run_day)::date
             ELSE run_day END AS bucket,
        domain, SUM(response_count) AS cnt
      FROM aeo_cache_domains
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND domain IN (SELECT domain FROM relevant)
      GROUP BY bucket, domain
    )
    SELECT dd.bucket, dd.domain,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd
    JOIN daily_totals dt USING (bucket)
    ORDER BY dd.bucket, dd.domain;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT id,
             CASE WHEN p_granularity = 'weekly'
                  THEN date_trunc('week', run_day)::date
                  ELSE run_day END AS bucket
      FROM responses
      WHERE run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR tags = p_tags)
    ),
    totals AS (SELECT bucket, COUNT(*) AS n FROM filtered GROUP BY bucket),
    top_domains AS (
      SELECT cd.domain
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE (cd.citation_type = 'Competition' AND cd.domain NOT LIKE '%clay%')
      GROUP BY cd.domain
      ORDER BY COUNT(*) DESC
      LIMIT p_top_n
    ),
    relevant AS (
      SELECT domain FROM top_domains UNION SELECT 'clay.com'
    ),
    domain_counts AS (
      SELECT f.bucket, cd.domain, COUNT(cd.response_id) AS cnt
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IN (SELECT domain FROM relevant)
      GROUP BY f.bucket, cd.domain
    )
    SELECT dc.bucket, dc.domain,
      CASE WHEN t.n > 0 THEN dc.cnt::float / t.n * 100 ELSE 0 END
    FROM domain_counts dc
    JOIN totals t USING (bucket)
    ORDER BY dc.bucket, dc.domain;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT,TEXT)
  TO anon, authenticated;


-- ── RPC 5: Sentiment timeseries (positive/neutral/negative) ─────────
CREATE OR REPLACE FUNCTION get_sentiment_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, positive FLOAT, neutral FLOAT, negative FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      SUM(positive_sentiment)::float / NULLIF(SUM(clay_mentioned), 0) * 100,
      SUM(neutral_sentiment)::float  / NULLIF(SUM(clay_mentioned), 0) * 100,
      SUM(negative_sentiment)::float / NULLIF(SUM(clay_mentioned), 0) * 100
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY bucket
    ORDER BY bucket;
  ELSE
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Positive')::float
        / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Neutral')::float
        / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100,
      COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes' AND brand_sentiment = 'Negative')::float
        / NULLIF(COUNT(*) FILTER (WHERE clay_mentioned ILIKE 'yes'), 0) * 100
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY bucket
    ORDER BY bucket;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sentiment_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 6: Claygent/MCP mention count timeseries ────────────────────
CREATE OR REPLACE FUNCTION get_claygent_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      SUM(claygent_mentioned)
    FROM aeo_cache_daily
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY bucket
    ORDER BY bucket;
  ELSE
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
    FROM responses
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY bucket
    ORDER BY bucket;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claygent_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 7: Claygent/MCP mentions by platform ────────────────────────
CREATE OR REPLACE FUNCTION get_claygent_platform_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, platform TEXT, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      d.platform, SUM(claygent_mentioned)
    FROM aeo_cache_daily d
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
    GROUP BY bucket, d.platform
    ORDER BY bucket, d.platform;
  ELSE
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', run_day)::date
           ELSE run_day END AS bucket,
      r.platform,
      COUNT(*) FILTER (WHERE claygent_or_mcp_mentioned ILIKE 'yes')
    FROM responses r
    WHERE run_day BETWEEN p_start_day AND p_end_day
      AND (p_prompt_type = 'all' OR prompt_type ILIKE p_prompt_type)
      AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL OR platform = ANY(p_platforms))
      AND (p_branded_filter = 'all'
           OR (p_branded_filter = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded_filter = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_tags = 'all' OR tags = p_tags)
    GROUP BY bucket, r.platform
    ORDER BY bucket, r.platform;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claygent_platform_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;


-- ── RPC 8: Clay follow-up count timeseries ──────────────────────────
DROP FUNCTION IF EXISTS get_followup_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE OR REPLACE FUNCTION get_followup_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_granularity    TEXT    DEFAULT 'daily'
)
RETURNS TABLE(date DATE, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', d.run_day)::date
           ELSE d.run_day END AS bucket,
      SUM(d.clay_followup)::BIGINT
    FROM aeo_cache_daily d
    WHERE d.run_day BETWEEN p_start_day AND p_end_day
      AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
      AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
    GROUP BY bucket
    ORDER BY bucket;
  ELSE
    RETURN QUERY
    SELECT
      CASE WHEN p_granularity = 'weekly'
           THEN date_trunc('week', r.run_day)::date
           ELSE r.run_day END AS bucket,
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
    GROUP BY bucket
    ORDER BY bucket;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_followup_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,TEXT)
  TO anon, authenticated;
