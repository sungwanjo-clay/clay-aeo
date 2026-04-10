-- ============================================================
-- RPC: upsert_visibility_response
--
-- Called by Clay HTTP API columns (one per platform) after all
-- enrichment columns complete. Handles all multi-table logic
-- atomically: prompts → responses → citation_domains →
-- response_competitors.
--
-- Supports two payload formats:
--   1. Flat snake_case (original Clay table):
--      payload.clay_mentioned, payload.brand_sentiment, etc.
--   2. Nested camelCase (Claude demo table):
--      payload.analyzer.clayMentioned, payload.analyzer.brandSentiment, etc.
--      payload.parsed_response for response_text
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_visibility_response(payload JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_prompt_id     UUID;
  v_response_id   UUID;
  v_analyzer      JSONB;
  v_citations     JSONB;
  v_cited_urls    JSONB;
  v_cited_domains JSONB;
  v_cited_titles  JSONB;
BEGIN
  -- ── Normalise payload ───────────────────────────────────────
  -- If Clay sends { analyzer: { clayMentioned: ... }, parsed_response: "..." }
  -- we read from the nested object; otherwise fall back to flat snake_case keys.
  v_analyzer := COALESCE(payload->'analyzer', '{}'::jsonb);

  v_citations := COALESCE(
    v_analyzer->'citations',
    payload->'citations',
    '[]'::jsonb
  );

  -- Extract cited arrays from citations objects when not sent as flat arrays
  v_cited_urls := COALESCE(
    payload->'cited_urls',
    (SELECT jsonb_agg(c->>'url')    FROM jsonb_array_elements(v_citations) c WHERE c->>'url'    IS NOT NULL)
  );
  v_cited_domains := COALESCE(
    payload->'cited_domains',
    (SELECT jsonb_agg(c->>'domain') FROM jsonb_array_elements(v_citations) c WHERE c->>'domain' IS NOT NULL)
  );
  v_cited_titles := COALESCE(
    payload->'cited_titles',
    (SELECT jsonb_agg(c->>'title')  FROM jsonb_array_elements(v_citations) c WHERE c->>'title'  IS NOT NULL)
  );

  -- ── Upsert prompt ───────────────────────────────────────────
  INSERT INTO prompts (
    prompt_text, prompt_type, tags, topic, intent, pmm_use_case,
    pmm_classification, branded_or_non_branded, parent_brand,
    verb_modifier, noun_modifier, verb_noun, is_active, last_seen_at
  )
  VALUES (
    payload->>'prompt_text',
    payload->>'prompt_type',
    payload->>'tags',
    payload->>'topic',
    payload->>'intent',
    payload->>'pmm_use_case',
    payload->>'pmm_classification',
    payload->>'branded_or_non_branded',
    payload->>'parent_brand',
    payload->>'verb_modifier',
    payload->>'noun_modifier',
    payload->>'verb_noun',
    true,
    NOW()
  )
  ON CONFLICT (prompt_text) DO UPDATE SET
    prompt_type            = EXCLUDED.prompt_type,
    tags                   = EXCLUDED.tags,
    topic                  = EXCLUDED.topic,
    intent                 = EXCLUDED.intent,
    pmm_use_case           = EXCLUDED.pmm_use_case,
    pmm_classification     = EXCLUDED.pmm_classification,
    branded_or_non_branded = EXCLUDED.branded_or_non_branded,
    is_active              = true,
    last_seen_at           = NOW()
  RETURNING prompt_id INTO v_prompt_id;

  -- ── Upsert response ─────────────────────────────────────────
  -- run_date is stamped by Supabase (NOW()), not sent by Clay.
  -- run_day is the DATE-only column used for the unique index
  -- (prompt_id, platform, run_day) — same-day re-runs overwrite.
  INSERT INTO responses (
    run_date, run_day, prompt_id, platform,
    response_text, cited_urls, cited_domains, cited_titles,
    clay_mentioned, clay_mention_position, clay_mention_snippet,
    brand_sentiment, brand_sentiment_score,
    clay_recommended_followup, clay_followup_snippet,
    claygent_or_mcp_mentioned, claygent_or_mcp_snippet, number_of_tools_recommended,
    sentiment_score, citation_type, citations,
    competitors_mentioned, themes,
    primary_use_case_attributed, positioning_vs_competitors,
    total_credits_charged,
    prompt_type, tags, topic, intent,
    pmm_use_case, pmm_classification, branded_or_non_branded
  )
  VALUES (
    NOW(),
    CURRENT_DATE,
    v_prompt_id,
    payload->>'platform',
    -- response_text: flat key or parsed_response (Claude demo formula column)
    COALESCE(payload->>'response_text', payload->>'parsed_response'),
    v_cited_urls,
    v_cited_domains,
    v_cited_titles,
    -- analyzer fields: camelCase nested OR flat snake_case
    COALESCE(v_analyzer->>'clayMentioned',              payload->>'clay_mentioned'),
    COALESCE((v_analyzer->>'clayMentionPosition')::int, (payload->>'clay_mention_position')::int),
    COALESCE(v_analyzer->>'clayMentionSnippet',         payload->>'clay_mention_snippet'),
    COALESCE(v_analyzer->>'brandSentiment',             payload->>'brand_sentiment'),
    COALESCE((v_analyzer->>'brandSentimentScore')::int, (payload->>'brand_sentiment_score')::int),
    COALESCE(v_analyzer->>'clayRecommendedFollowup',    payload->>'clay_recommended_followup'),
    COALESCE(v_analyzer->>'clayFollowupSnippet',        payload->>'clay_followup_snippet'),
    COALESCE(v_analyzer->>'claygentOrMcpMentioned',     payload->>'claygent_or_mcp_mentioned'),
    COALESCE(v_analyzer->>'claygentOrMcpMentionSnippet', payload->>'claygent_or_mcp_snippet'),
    COALESCE((v_analyzer->>'numberOfToolsRecommended')::int, (payload->>'number_of_tools_recommended')::int),
    COALESCE((v_analyzer->>'sentimentScore')::int,      (payload->>'sentiment_score')::int),
    COALESCE(v_analyzer->>'citationType',               payload->>'citation_type'),
    v_citations,
    COALESCE(v_analyzer->'competitorsMentioned',        payload->'competitors_mentioned'),
    COALESCE(v_analyzer->'themes',                      payload->'themes'),
    COALESCE(v_analyzer->>'primaryUseCaseAttributed',   payload->>'primary_use_case_attributed'),
    COALESCE(v_analyzer->>'positioningVsCompetitors',   payload->>'positioning_vs_competitors'),
    COALESCE((v_analyzer->>'totalCreditsCharged')::float, (payload->>'total_credits_charged')::float),
    payload->>'prompt_type',
    payload->>'tags',
    payload->>'topic',
    payload->>'intent',
    payload->>'pmm_use_case',
    payload->>'pmm_classification',
    payload->>'branded_or_non_branded'
  )
  ON CONFLICT (prompt_id, platform, run_day) DO UPDATE SET
    response_text               = EXCLUDED.response_text,
    clay_mentioned              = EXCLUDED.clay_mentioned,
    clay_mention_position       = EXCLUDED.clay_mention_position,
    clay_mention_snippet        = EXCLUDED.clay_mention_snippet,
    brand_sentiment             = EXCLUDED.brand_sentiment,
    brand_sentiment_score       = EXCLUDED.brand_sentiment_score,
    clay_recommended_followup   = EXCLUDED.clay_recommended_followup,
    clay_followup_snippet       = EXCLUDED.clay_followup_snippet,
    claygent_or_mcp_mentioned   = EXCLUDED.claygent_or_mcp_mentioned,
    claygent_or_mcp_snippet     = EXCLUDED.claygent_or_mcp_snippet,
    number_of_tools_recommended = EXCLUDED.number_of_tools_recommended,
    sentiment_score             = EXCLUDED.sentiment_score,
    citation_type               = EXCLUDED.citation_type,
    citations                   = EXCLUDED.citations,
    cited_urls                  = EXCLUDED.cited_urls,
    cited_domains               = EXCLUDED.cited_domains,
    cited_titles                = EXCLUDED.cited_titles,
    competitors_mentioned       = EXCLUDED.competitors_mentioned,
    themes                      = EXCLUDED.themes,
    primary_use_case_attributed = EXCLUDED.primary_use_case_attributed,
    positioning_vs_competitors  = EXCLUDED.positioning_vs_competitors,
    total_credits_charged       = EXCLUDED.total_credits_charged,
    prompt_type                 = EXCLUDED.prompt_type,
    tags                        = EXCLUDED.tags,
    topic                       = EXCLUDED.topic,
    intent                      = EXCLUDED.intent,
    pmm_use_case                = EXCLUDED.pmm_use_case,
    pmm_classification          = EXCLUDED.pmm_classification,
    branded_or_non_branded      = EXCLUDED.branded_or_non_branded
  RETURNING id INTO v_response_id;

  -- ── Replace citation_domains for this response ──────────────
  DELETE FROM citation_domains WHERE response_id = v_response_id;

  INSERT INTO citation_domains (
    response_id, run_date, prompt_id, platform,
    domain, url, title, citation_type, url_type
  )
  SELECT
    v_response_id, NOW(), v_prompt_id, payload->>'platform',
    c->>'domain', c->>'url', c->>'title', c->>'type', c->>'urlType'
  FROM jsonb_array_elements(v_citations) AS c
  WHERE c->>'url' IS NOT NULL;

  -- ── Replace response_competitors for this response ──────────
  DELETE FROM response_competitors WHERE response_id = v_response_id;

  INSERT INTO response_competitors (
    response_id, run_date, prompt_id, platform, competitor_name
  )
  SELECT
    v_response_id, NOW(), v_prompt_id, payload->>'platform',
    comp.value
  FROM jsonb_array_elements_text(
    COALESCE(v_analyzer->'competitorsMentioned', payload->'competitors_mentioned', '[]'::jsonb)
  ) AS comp(value)
  WHERE comp.value IS NOT NULL AND comp.value <> '';

END;
$$;

-- ── Grant execute to anon + authenticated (required for Clay HTTP API) ────────
GRANT EXECUTE ON FUNCTION upsert_visibility_response(JSONB) TO anon, authenticated;
