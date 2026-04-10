-- ============================================================
-- Fix: slow-path denominator in get_competitor_citation_timeseries_rpc
-- ============================================================
-- Problem:
--   The slow path (used when branded_filter ≠ 'all' OR tags ≠ 'all') computed
--   its denominator as COUNT(DISTINCT cd.response_id) FROM citation_domains.
--   This diverges from the fast-path denominator (aeo_cache_daily.total_with_citations)
--   because ~39% of responses have citation_domains rows but an empty cited_domains
--   JSONB column. The KPI (get_citation_share_kpi) uses the JSONB-based count, so the
--   timeseries percentage was inconsistent with the KPI when filters were active.
--
-- Fix:
--   In the filtered MATERIALIZED CTE, add a boolean column `has_citation` based on
--   cited_domains JSONB (same source as the fast path and the KPI). Then compute
--   daily_totals as COUNT(*) FILTER (WHERE f.has_citation) — no JOIN to
--   citation_domains required for the denominator.
-- ============================================================

DROP FUNCTION IF EXISTS get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT);

CREATE FUNCTION get_competitor_citation_timeseries_rpc(
  p_start_day      DATE,
  p_end_day        DATE,
  p_prompt_type    TEXT    DEFAULT 'all',
  p_platforms      TEXT[]  DEFAULT '{}',
  p_branded_filter TEXT    DEFAULT 'all',
  p_tags           TEXT    DEFAULT 'all',
  p_top_n          INT     DEFAULT 5
)
RETURNS TABLE(date DATE, domain TEXT, value FLOAT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    -- ── Fast path: read from pre-aggregated cache tables ──────
    RETURN QUERY
    WITH daily_totals AS (
      -- Use aeo_cache_daily.total_with_citations = unique responses with any citation
      -- (JSONB-based). This is the correct denominator (not sum of domain citation events).
      SELECT d.run_day, SUM(d.total_with_citations) AS total_cited
      FROM aeo_cache_daily d
      WHERE d.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
      GROUP BY d.run_day
    ),
    top_competitors AS (
      -- alias to avoid clash with RETURNS TABLE "domain" variable
      SELECT acd2.domain AS dname
      FROM aeo_cache_domains acd2
      WHERE acd2.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd2.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd2.prompt_type ILIKE p_prompt_type)
        AND acd2.citation_type = 'Competition'
        AND acd2.domain NOT LIKE '%clay%'
      GROUP BY acd2.domain
      ORDER BY SUM(acd2.response_count) DESC
      LIMIT p_top_n
    ),
    relevant AS (
      SELECT tc.dname FROM top_competitors tc
      UNION SELECT 'clay.com'
    ),
    domain_day AS (
      SELECT acd3.run_day, acd3.domain AS dname, SUM(acd3.response_count) AS cnt
      FROM aeo_cache_domains acd3
      WHERE acd3.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd3.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd3.prompt_type ILIKE p_prompt_type)
        AND acd3.domain IN (SELECT r.dname FROM relevant r)
      GROUP BY acd3.run_day, acd3.domain
    )
    SELECT dd.run_day, dd.dname,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd
    JOIN daily_totals dt ON dt.run_day = dd.run_day
    ORDER BY dd.run_day, dd.dname;

  ELSE
    -- ── Slow path: scan responses + citation_domains directly ──
    --
    -- The filtered CTE now includes `has_citation` derived from the JSONB
    -- cited_domains column, matching the fast-path / KPI denominator source.
    -- daily_totals uses COUNT(*) FILTER (WHERE has_citation) instead of a JOIN
    -- to citation_domains, so both paths are now consistent.
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        r.id,
        r.run_day,
        -- JSONB-based flag: mirrors how aeo_cache_daily.total_with_citations is built
        (r.cited_domains IS NOT NULL AND jsonb_array_length(r.cited_domains) > 0) AS has_citation
      FROM responses r
      WHERE r.run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
    ),
    -- Denominator per day: filtered responses with any citation (JSONB-based, same as KPI)
    daily_totals AS (
      SELECT
        f.run_day,
        COUNT(*) FILTER (WHERE f.has_citation)::float AS total_cited
      FROM filtered f
      GROUP BY f.run_day
    ),
    cited AS (
      SELECT f.run_day, f.id AS response_id,
        CASE WHEN LOWER(cd.domain) LIKE '%clay.com%' THEN 'clay.com'
             ELSE LOWER(cd.domain) END AS dname,
        cd.citation_type
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    top_competitors AS (
      SELECT c2.dname
      FROM cited c2
      WHERE c2.citation_type = 'Competition' AND c2.dname NOT LIKE '%clay%'
      GROUP BY c2.dname
      ORDER BY COUNT(DISTINCT c2.response_id) DESC
      LIMIT p_top_n
    ),
    domain_day AS (
      SELECT c3.run_day, c3.dname, COUNT(DISTINCT c3.response_id) AS cnt
      FROM cited c3
      WHERE c3.dname IN (
        SELECT tc.dname FROM top_competitors tc
        UNION SELECT 'clay.com'
      )
      GROUP BY c3.run_day, c3.dname
    )
    SELECT dd.run_day, dd.dname,
      CASE WHEN dt.total_cited > 0 THEN dd.cnt::float / dt.total_cited * 100 ELSE 0 END
    FROM domain_day dd
    JOIN daily_totals dt ON dt.run_day = dd.run_day
    ORDER BY dd.run_day, dd.dname;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competitor_citation_timeseries_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT,INT)
  TO anon, authenticated;
