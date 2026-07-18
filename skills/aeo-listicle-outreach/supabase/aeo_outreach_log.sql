-- ============================================================
-- aeo_outreach_log
-- ============================================================
-- Tracks the AEO listicle outreach funnel: for each target URL,
-- who the author is, whether we reached out, and what happened.
-- Written by the aeo-listicle-outreach skill (SKILL.md alongside).
-- ============================================================

CREATE TABLE IF NOT EXISTS aeo_outreach_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Target article
  url            TEXT        NOT NULL,
  domain         TEXT        NOT NULL,
  title          TEXT,
  published_date DATE,

  -- Metrics that got it flagged
  citations_14d  INTEGER,                -- from aeo_cache_domain_urls SUM(url_count)
  ahrefs_dr      INTEGER,
  ahrefs_traffic INTEGER,
  format_type    TEXT,                    -- 'listicle' | 'comparison' | 'review' | 'guide'

  -- Author + enrichment
  author_name    TEXT,
  author_email   TEXT,
  author_linkedin TEXT,

  -- Mirror article
  mirror_keyword TEXT,
  mirror_slug    TEXT,                    -- path under .aeo-outreach/drafts/
  mirror_title   TEXT,

  -- Funnel state
  status         TEXT        NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued',
      'outline_ready',      -- stage 8a done, placeholders still present
      'draft_ready',        -- stage 8b done, screenshots/pricing filled
      'awaiting_review',    -- stage 8c done, Google Doc published, waiting on human
      'approved',           -- human OK'd the Google Doc
      'email_ready',        -- stage 9 done, outreach email drafted
      'sent',
      'replied',
      'mentioned',
      'published',
      'failed',
      'skipped'
    )),
  gdoc_url       TEXT,                    -- Google Doc URL for review (stage 8c)
  status_note    TEXT,                    -- freeform: failure reason, reply gist, etc.

  -- Idempotency
  run_id         TEXT,                    -- caller-supplied identifier for a single skill run

  CONSTRAINT aeo_outreach_log_url_unique UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_aeo_outreach_status  ON aeo_outreach_log (status);
CREATE INDEX IF NOT EXISTS idx_aeo_outreach_domain  ON aeo_outreach_log (domain);
CREATE INDEX IF NOT EXISTS idx_aeo_outreach_updated ON aeo_outreach_log (updated_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_aeo_outreach_log_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aeo_outreach_log_updated_at ON aeo_outreach_log;
CREATE TRIGGER trg_aeo_outreach_log_updated_at
BEFORE UPDATE ON aeo_outreach_log
FOR EACH ROW EXECUTE FUNCTION set_aeo_outreach_log_updated_at();
