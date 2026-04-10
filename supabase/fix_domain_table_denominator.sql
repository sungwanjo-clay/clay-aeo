-- Fix get_top_cited_domains_rpc: wrong denominator in fast path
--
-- Root cause: fast path used SUM(response_count) across the top-20 domains as
-- denominator. But each cited response appears in multiple domains (avg 6.7×),
-- so this inflates the denominator by ~1.64× and deflates all share_pct values
-- by the same factor (e.g. 19.8% true rate shows as 12.1%).
--
-- Fix: use SUM(aeo_cache_daily.total_with_citations) for the same period/platform/
-- prompt_type as denominator — identical to what the line chart uses. This makes
-- the domain table "Response %" match the line chart exactly.

DROP FUNCTION IF EXISTS get_top_cited_domains_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT);

CREATE FUNCTION get_top_cited_domains_rpc(
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
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET statement_timeout = '30000'
AS $$
BEGIN
  IF p_branded_filter = 'all' AND p_tags = 'all' THEN
    RETURN QUERY
    WITH domain_agg AS (
      SELECT
        acd.domain                                              AS dname,
        SUM(acd.response_count)                                AS response_count,
        mode() WITHIN GROUP (ORDER BY acd.citation_type)       AS ctype,
        BOOL_OR(acd.domain LIKE '%clay.com%')                  AS is_clay
      FROM aeo_cache_domains acd
      WHERE acd.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR acd.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR acd.prompt_type ILIKE p_prompt_type)
      GROUP BY acd.domain
      ORDER BY SUM(acd.response_count) DESC
      LIMIT 20
    ),
    -- Correct denominator: unique responses with any citation for the period.
    -- Use aeo_cache_daily.total_with_citations — same source as Citation Rate KPI
    -- and line chart, so all three metrics are directly comparable.
    total_cited AS (
      SELECT SUM(d.total_with_citations)::float AS n
      FROM aeo_cache_daily d
      WHERE d.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR d.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR d.prompt_type ILIKE p_prompt_type)
    ),
    url_agg AS (
      SELECT
        du.domain                                                                     AS dname,
        du.url,
        MAX(du.title)                                                                 AS title,
        SUM(du.url_count)                                                             AS cnt,
        ROW_NUMBER() OVER (PARTITION BY du.domain ORDER BY SUM(du.url_count) DESC)   AS rn
      FROM aeo_cache_domain_urls du
      WHERE du.run_day BETWEEN p_start_day AND p_end_day
        AND (array_length(p_platforms,1) IS NULL OR du.platform = ANY(p_platforms))
        AND (p_prompt_type = 'all' OR du.prompt_type ILIKE p_prompt_type)
        AND du.domain IN (SELECT da.dname FROM domain_agg da)
      GROUP BY du.domain, du.url
    ),
    top_urls AS (
      SELECT ua.dname,
        jsonb_agg(
          jsonb_build_object('url', ua.url, 'title', ua.title, 'count', ua.cnt)
          ORDER BY ua.cnt DESC
        ) AS top_urls
      FROM url_agg ua
      WHERE ua.rn <= 8
      GROUP BY ua.dname
    )
    SELECT
      da.dname,
      da.response_count::BIGINT,
      CASE WHEN tc.n > 0 THEN da.response_count::float / tc.n * 100 ELSE 0 END,
      da.is_clay,
      da.ctype,
      COALESCE(tu.top_urls, '[]'::jsonb)
    FROM domain_agg da
    CROSS JOIN total_cited tc
    LEFT JOIN top_urls tu ON tu.dname = da.dname
    ORDER BY da.response_count DESC;

  ELSE
    -- Slow path (branded / tags filter): scan citation_domains + responses
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT r.id FROM responses r
      WHERE r.run_day BETWEEN p_start_day AND p_end_day
        AND (p_prompt_type = 'all' OR r.prompt_type ILIKE p_prompt_type)
        AND (p_platforms IS NULL OR array_length(p_platforms,1) IS NULL
             OR r.platform = ANY(p_platforms))
        AND (p_branded_filter = 'all'
             OR (p_branded_filter = 'branded'     AND r.branded_or_non_branded ILIKE 'branded')
             OR (p_branded_filter = 'non-branded' AND r.branded_or_non_branded NOT ILIKE 'branded'))
        AND (p_tags = 'all' OR r.tags = p_tags)
    ),
    citations AS (
      SELECT LOWER(cd.domain) AS dname, cd.url, cd.title,
             cd.citation_type, cd.response_id
      FROM citation_domains cd
      JOIN filtered f ON f.id = cd.response_id
      WHERE cd.domain IS NOT NULL
    ),
    total_cited AS (
      SELECT COUNT(DISTINCT c.response_id)::float AS n FROM citations c
    ),
    domain_stats AS (
      SELECT c.dname,
        COUNT(DISTINCT c.response_id)::BIGINT                AS response_count,
        BOOL_OR(c.dname LIKE '%clay.com%')                   AS is_clay,
        mode() WITHIN GROUP (ORDER BY c.citation_type)       AS ctype
      FROM citations c
      GROUP BY c.dname
    ),
    url_ranked AS (
      SELECT c.dname, c.url, MAX(c.title) AS title, COUNT(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY c.dname ORDER BY COUNT(*) DESC) AS rn
      FROM citations c WHERE c.url IS NOT NULL
      GROUP BY c.dname, c.url
    ),
    top_urls AS (
      SELECT ur.dname,
        jsonb_agg(
          jsonb_build_object('url', ur.url, 'title', ur.title, 'count', ur.cnt)
          ORDER BY ur.cnt DESC
        ) AS top_urls
      FROM url_ranked ur WHERE ur.rn <= 8
      GROUP BY ur.dname
    )
    SELECT
      ds.dname, ds.response_count,
      CASE WHEN tc.n > 0 THEN ds.response_count::float / tc.n * 100 ELSE 0 END,
      ds.is_clay, ds.ctype,
      COALESCE(tu.top_urls, '[]'::jsonb)
    FROM domain_stats ds
    CROSS JOIN total_cited tc
    LEFT JOIN top_urls tu ON tu.dname = ds.dname
    ORDER BY ds.response_count DESC
    LIMIT 20;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_top_cited_domains_rpc(DATE,DATE,TEXT,TEXT[],TEXT,TEXT)
  TO anon, authenticated;
