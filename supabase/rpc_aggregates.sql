-- ============================================================
-- Aggregate RPCs — run in Supabase SQL Editor
-- Needed because citation_domains has 33k+ rows and grows with
-- each run, making client-side GROUP BY impractical.
-- ============================================================

-- ── Top cited domains (GROUP BY server-side) ─────────────────
-- Returns top 30 domains with counts and most-common citation_type.
-- Accepts ISO date strings for the run_date range on citation_domains.
CREATE OR REPLACE FUNCTION get_top_cited_domains(
  p_start_day  TEXT,   -- 'YYYY-MM-DD'
  p_end_day    TEXT,   -- 'YYYY-MM-DD' exclusive upper bound
  p_platforms  TEXT[]  DEFAULT NULL
)
RETURNS TABLE(
  domain        TEXT,
  citation_count BIGINT,
  citation_type TEXT,
  share_pct     NUMERIC
) LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT domain, citation_type
    FROM citation_domains
    WHERE run_date >= p_start_day::TIMESTAMPTZ
      AND run_date <  p_end_day::TIMESTAMPTZ
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND domain IS NOT NULL AND domain <> ''
  ),
  counts AS (
    SELECT domain, COUNT(*)::BIGINT AS cnt
    FROM filtered
    GROUP BY domain
  ),
  -- pick most frequent citation_type per domain using DISTINCT ON (no correlated subquery)
  type_rank AS (
    SELECT domain, citation_type, COUNT(*) AS type_cnt
    FROM filtered
    WHERE citation_type IS NOT NULL
    GROUP BY domain, citation_type
  ),
  top_type AS (
    SELECT DISTINCT ON (domain) domain, citation_type
    FROM type_rank
    ORDER BY domain, type_cnt DESC
  ),
  total AS (SELECT SUM(cnt) AS grand FROM counts)
  SELECT
    c.domain,
    c.cnt AS citation_count,
    t.citation_type,
    ROUND(c.cnt * 100.0 / NULLIF((SELECT grand FROM total), 0), 2) AS share_pct
  FROM counts c
  LEFT JOIN top_type t ON c.domain = t.domain
  ORDER BY c.cnt DESC
  LIMIT 30;
$$;

-- ── Competitor visibility leaderboard (GROUP BY server-side) ──
-- Returns mention counts and visibility % for each competitor.
CREATE OR REPLACE FUNCTION get_competitor_leaderboard(
  p_start_day    TEXT,
  p_end_day      TEXT,
  p_prompt_type  TEXT    DEFAULT NULL,
  p_branded      TEXT    DEFAULT NULL,   -- 'branded' | 'non-branded' | NULL
  p_platforms    TEXT[]  DEFAULT NULL,
  p_tags         TEXT    DEFAULT NULL,
  p_prev_start   TEXT    DEFAULT NULL,
  p_prev_end     TEXT    DEFAULT NULL
)
RETURNS TABLE(
  competitor_name TEXT,
  mention_count   BIGINT,
  visibility_score NUMERIC,
  prev_score       NUMERIC
) LANGUAGE sql STABLE AS $$
  WITH cur_responses AS (
    SELECT id FROM responses
    WHERE run_day BETWEEN p_start_day::DATE AND p_end_day::DATE
      AND (p_prompt_type IS NULL OR prompt_type ILIKE p_prompt_type)
      AND (
        p_branded IS NULL
        OR (p_branded = 'branded'     AND branded_or_non_branded ILIKE 'branded')
        OR (p_branded = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded')
      )
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_tags IS NULL OR tags = p_tags)
  ),
  cur_total AS (SELECT COUNT(*) AS n FROM cur_responses),
  prev_responses AS (
    SELECT id FROM responses
    WHERE p_prev_start IS NOT NULL
      AND run_day BETWEEN p_prev_start::DATE AND p_prev_end::DATE
      AND (p_prompt_type IS NULL OR prompt_type ILIKE p_prompt_type)
      AND (
        p_branded IS NULL
        OR (p_branded = 'branded'     AND branded_or_non_branded ILIKE 'branded')
        OR (p_branded = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded')
      )
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_tags IS NULL OR tags = p_tags)
  ),
  prev_total AS (SELECT COUNT(*) AS n FROM prev_responses),
  cur_counts AS (
    SELECT rc.competitor_name, COUNT(DISTINCT rc.response_id)::BIGINT AS cnt
    FROM response_competitors rc
    INNER JOIN cur_responses cr ON rc.response_id = cr.id
    GROUP BY rc.competitor_name
  ),
  prev_counts AS (
    SELECT rc.competitor_name, COUNT(DISTINCT rc.response_id)::BIGINT AS cnt
    FROM response_competitors rc
    INNER JOIN prev_responses pr ON rc.response_id = pr.id
    GROUP BY rc.competitor_name
  )
  SELECT
    cc.competitor_name,
    cc.cnt AS mention_count,
    ROUND(cc.cnt * 100.0 / NULLIF((SELECT n FROM cur_total), 0), 2) AS visibility_score,
    ROUND(pc.cnt * 100.0 / NULLIF((SELECT n FROM prev_total), 0), 2) AS prev_score
  FROM cur_counts cc
  LEFT JOIN prev_counts pc ON cc.competitor_name = pc.competitor_name
  ORDER BY cc.cnt DESC;
$$;

-- ── Citation share (% of cited responses that cite clay.com) ─────────────────
-- Returns {current, previous} as JSON. Uses COUNT(DISTINCT response_id) so
-- each response is counted once regardless of how many clay URLs it cites.
CREATE OR REPLACE FUNCTION get_citation_share(
  p_start_day   TEXT,
  p_end_day     TEXT,
  p_prompt_type TEXT    DEFAULT NULL,
  p_branded     TEXT    DEFAULT NULL,
  p_platforms   TEXT[]  DEFAULT NULL,
  p_tags        TEXT    DEFAULT NULL,
  p_prev_start  TEXT    DEFAULT NULL,
  p_prev_end    TEXT    DEFAULT NULL
) RETURNS JSON LANGUAGE sql STABLE AS $$
  WITH cur_filtered AS (
    SELECT id FROM responses
    WHERE run_day BETWEEN p_start_day::DATE AND p_end_day::DATE
      AND (p_prompt_type IS NULL OR prompt_type ILIKE p_prompt_type)
      AND (p_branded IS NULL
           OR (p_branded = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_tags IS NULL OR tags = p_tags)
  ),
  prev_filtered AS (
    SELECT id FROM responses
    WHERE p_prev_start IS NOT NULL
      AND run_day BETWEEN p_prev_start::DATE AND p_prev_end::DATE
      AND (p_prompt_type IS NULL OR prompt_type ILIKE p_prompt_type)
      AND (p_branded IS NULL
           OR (p_branded = 'branded'     AND branded_or_non_branded ILIKE 'branded')
           OR (p_branded = 'non-branded' AND branded_or_non_branded NOT ILIKE 'branded'))
      AND (p_platforms IS NULL OR platform = ANY(p_platforms))
      AND (p_tags IS NULL OR tags = p_tags)
  ),
  cur_counts AS (
    SELECT
      COUNT(DISTINCT cd.response_id) FILTER (WHERE cd.domain ILIKE '%clay%') AS clay,
      COUNT(DISTINCT cd.response_id) AS total
    FROM citation_domains cd
    INNER JOIN cur_filtered f ON cd.response_id = f.id
  ),
  prev_counts AS (
    SELECT
      COUNT(DISTINCT cd.response_id) FILTER (WHERE cd.domain ILIKE '%clay%') AS clay,
      COUNT(DISTINCT cd.response_id) AS total
    FROM citation_domains cd
    INNER JOIN prev_filtered pf ON cd.response_id = pf.id
  )
  SELECT json_build_object(
    'current',  CASE WHEN (SELECT total FROM cur_counts)  > 0 THEN ROUND((SELECT clay FROM cur_counts)  * 100.0 / (SELECT total FROM cur_counts),  2) ELSE NULL END,
    'previous', CASE WHEN (SELECT total FROM prev_counts) > 0 THEN ROUND((SELECT clay FROM prev_counts) * 100.0 / (SELECT total FROM prev_counts), 2) ELSE NULL END
  )
$$;

GRANT EXECUTE ON FUNCTION get_top_cited_domains(TEXT, TEXT, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_competitor_leaderboard(TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_citation_share(TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) TO anon, authenticated;
