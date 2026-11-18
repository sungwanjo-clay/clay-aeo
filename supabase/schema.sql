-- Startup portfolio penetration: Supabase schema (DRAFT, not applied anywhere yet).
--
-- Two layers:
--   raw      source_records keeps everything every provider/scrape returned, append-only, as JSON.
--            Nothing a workflow fetches is thrown away, so new fields can be promoted later without re-enriching.
--   curated  typed tables the dashboard reads, through the dashboard_* views at the bottom.
--
-- Writers: the Clay workflows (roster + eligibility) via the PostgREST API, upserting on the *_key columns.
-- Reader:  scripts/sync-portfolio.mjs with a read-only role, reading only the dashboard_* views.
-- Clay account status (workspace / paid / redeemed) is NOT taken from here for the dashboard: the page
-- joins live against Snowflake CUSTOMERS. clay_account in snapshots is the as-of record for eligibility history.

-- ───────────────────────── Firms (from the "Venture Partner Program Priorities" sheet) ─────────────────────────
create table firms (
  firm_key              text primary key,                 -- slug of the name, e.g. 'y-combinator'
  name                  text not null,
  firm_type             text not null default 'vc_fund' check (firm_type in ('vc_fund', 'accelerator', 'other')),
  partner_status        text not null check (partner_status in ('partner', 'proven_partner', 'to_approve', 'not_partner')),
  source_tab            text not null check (source_tab in ('All Priority', 'Proven', 'To Approve')),
  stage_focus           text,                             -- as written in the sheet, e.g. 'Pre-seed, Seed'
  is_multi_stage        boolean not null default false,   -- the sheet's "(multi-stage - flagged)"
  sector_focus          text,
  region                text,
  outreached            boolean not null default false,
  referral_url          text,
  referral_utm_campaign text,                             -- e.g. 'wedge-floodgate-referral'; joins to Snowflake page views
  referral_utm_medium   text,                             -- 'community' or 'influencerpartner'
  poc_name              text,                             -- contact fields stay in Supabase; not in dashboard views
  poc_email             text,
  poc_email_2           text,
  domain                text,
  portfolio_url         text,                             -- the firm's own portfolio page, if any
  harmonic_investor_id  text,
  pitchbook_investor_id text,
  crunchbase_slug       text,
  dealroom_id           text,
  roster_refreshed_at   timestamptz,                      -- last successful roster run for this firm
  updated_at            timestamptz not null default now()
);

-- ───────────────────────── Companies (one row per real company, stealth included) ─────────────────────────
create table companies (
  company_key        text primary key,  -- the domain if known, else 'harmonic:<id>', else 'pitchbook:<id>', else 'name:<slug>'
  name               text not null,
  domain             text unique,
  aliases            text[] not null default '{}',   -- other names / old domains, for matching
  is_stealth         boolean not null default false,
  harmonic_id        text unique,
  pitchbook_id       text unique,
  crunchbase_slug    text unique,
  dealroom_id        text unique,
  yc_slug            text unique,                     -- ycombinator.com/companies/<slug>
  linkedin_url       text,
  website_status     text check (website_status in ('live', 'parked', 'down', 'none')),
  description        text,
  hq_country         text,
  hq_city            text,
  founded_year       int,
  industry           text,
  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ───────────────────────── Company × firm (the roster: who backs whom) ─────────────────────────
create table company_firms (
  company_key          text not null references companies on update cascade,
  firm_key             text not null references firms on update cascade,
  relationship         text not null check (relationship in ('investor', 'lead_investor', 'cohort')),
  round_or_batch       text,                 -- 'seed', 'series_a', or a YC batch like 'W26'
  invested_at          date,                 -- investment or cohort date (YC: batch start, not launch date)
  found_via            text[] not null,      -- any of 'firm_first', 'company_first', 'partner_list', 'workspace_match'
  sources              text[] not null,      -- providers that list this link, e.g. {harmonic,crunchbase}
  evidence_url         text,                 -- best original citation
  shared_by_partner    boolean not null default false,
  verification_status  text not null default 'review' check (verification_status in ('verified', 'review', 'rejected', 'removed')),
  verification_note    text,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),   -- last run that still found it
  primary key (company_key, firm_key)
);

-- ───────────────────────── Funding rounds (drives stage, recency, invested_at) ─────────────────────────
create table funding_rounds (
  company_key      text not null references companies on update cascade,
  round_type       text not null,          -- 'pre_seed', 'seed', 'series_a', 'series_b', ...
  announced_at     date not null,
  amount_usd       numeric,
  lead_investors   text[] not null default '{}',
  investors        text[] not null default '{}',
  sources          text[] not null,
  source_url       text,
  primary key (company_key, round_type, announced_at)
);

-- ───────────────────────── Weekly snapshot (eligibility + score history; append-only) ─────────────────────────
create table company_snapshots (
  snapshot_date           date not null,
  company_key             text not null references companies on update cascade,
  funding_stage           text,                      -- latest verified round
  last_round_at           date,
  last_round_amount_usd   numeric,
  total_raised_usd        numeric,
  is_vc_backed            boolean,
  headcount               int,
  headcount_6m_ago        int,
  headcount_growth_6m_pct numeric,
  company_fit             text not null check (company_fit in ('eligible', 'not_eligible', 'unknown')),
  fit_reason              text,                      -- e.g. 'series_b_or_later', 'not_venture_backed', 'pre_seed'
  clay_account            text check (clay_account in ('none', 'free', 'paid', 'unknown')),  -- as of this snapshot
  matched_workspace_ids   text[] not null default '{}',
  net_new_check           text not null check (net_new_check in ('pass', 'fail', 'needs_check')),
  net_new_reason          text,                      -- e.g. 'existing_free_workspace', 'already_paying', 'no_domain_match'
  offer_tier_credits      int,                       -- 10000 / 6000, as the eligibility workflow assigns
  opportunity_score       numeric,                   -- provisional; null when signals are missing
  score_drivers           jsonb,                     -- {"funding_recency": 0.4, "headcount_growth": 0.3, ...}
  data_gaps               text[] not null default '{}',  -- e.g. {no_headcount,no_domain}
  primary key (snapshot_date, company_key)
);

-- ───────────────────────── Applications (mirrors the sheet's Applications tab; one row per event) ─────────────────────────
create table application_events (
  event_id           text primary key,
  application_id     text not null,
  entry_type         text not null,          -- 'application', 'override', ...
  decision           text not null,          -- 'accepted', 'rejected', 'manual_review', 'pending_delivery', ...
  company_key        text references companies on update cascade,
  company_domain     text,
  company_name       text,
  applicant_email    text,                   -- not in dashboard views
  funding_stage      text,
  funding_source_url text,
  credits            int,
  rejection_reason   text,
  is_test            boolean not null default false,
  updated_at         timestamptz not null,
  record             jsonb not null          -- the full record JSON
);

-- ───────────────────────── Raw layer: everything fetched, never overwritten ─────────────────────────
create table source_records (
  record_id     bigint generated always as identity primary key,
  run_id        uuid,
  source        text not null,   -- 'harmonic','pitchbook','crunchbase','dealroom','yc_directory','portfolio_page','partner_list','announcement','claygent','google'
  record_type   text not null,   -- 'portfolio_listing','company_profile','funding_round','headcount','investor_list'
  company_key   text,            -- nullable: a listing may not be resolved to a company yet
  firm_key      text,
  external_id   text,
  source_url    text,
  observed_at   timestamptz not null default now(),
  payload       jsonb not null
);
create index on source_records (company_key);
create index on source_records (firm_key, source);

-- ───────────────────────── Runs (freshness, failures, "keep last good data") ─────────────────────────
create table workflow_runs (
  run_id       uuid primary key default gen_random_uuid(),
  workflow     text not null check (workflow in ('roster', 'eligibility', 'applications')),
  firm_key     text references firms on update cascade,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  counts       jsonb,            -- {"found": 412, "new": 9, "verified": 388, "review": 24, "by_source": {...}}
  error        text
);

-- ═════════════════════════ Dashboard contract: the only things the sync reads ═════════════════════════
-- No contact fields (poc_*, applicant_email) appear below.

create view latest_snapshots as
  select distinct on (company_key) * from company_snapshots order by company_key, snapshot_date desc;

-- Counts toward the penetration denominator: verified, and found by something other than our own workspace match.
create view roster_counted as
  select * from company_firms
  where verification_status = 'verified' and found_via <> '{workspace_match}';

create view dashboard_companies as
  select cf.company_key, cf.firm_key, c.name, c.domain, c.is_stealth, c.linkedin_url, c.hq_country, c.industry,
         cf.relationship, cf.round_or_batch, cf.invested_at, cf.sources, cf.found_via, cf.evidence_url,
         cf.shared_by_partner, cf.verification_status,
         (cf.verification_status = 'verified' and cf.found_via <> '{workspace_match}') as in_denominator,
         s.snapshot_date, s.funding_stage, s.last_round_at, s.last_round_amount_usd, s.total_raised_usd,
         s.headcount, s.headcount_growth_6m_pct, s.company_fit, s.fit_reason, s.net_new_check, s.net_new_reason,
         s.offer_tier_credits, s.opportunity_score, s.score_drivers, s.data_gaps,
         (s.company_fit = 'eligible' and s.net_new_check = 'pass') as is_eligible,
         c.first_seen_at
  from company_firms cf
  join companies c using (company_key)
  left join latest_snapshots s using (company_key)
  where cf.verification_status in ('verified', 'review');

create view dashboard_firms as
  select f.firm_key, f.name, f.firm_type, f.partner_status, f.stage_focus, f.is_multi_stage, f.region,
         f.referral_utm_campaign, f.outreached, f.roster_refreshed_at,
         count(*) filter (where d.in_denominator)                                   as verified_portfolio,
         count(*) filter (where d.in_denominator and d.shared_by_partner)           as shared_by_partner,
         count(*) filter (where d.verification_status = 'review')                   as in_review,
         count(*) filter (where d.found_via = '{workspace_match}')                  as workspace_match_only,
         count(*) filter (where d.in_denominator and d.is_eligible)                 as eligible,
         count(*) filter (where d.in_denominator and d.company_fit = 'eligible' and d.net_new_check = 'needs_check') as needs_check,
         count(*) filter (where d.in_denominator and d.first_seen_at >= now() - interval '7 days') as added_7d
  from firms f
  left join dashboard_companies d using (firm_key)
  group by f.firm_key;

-- Which sources find companies the others miss (per firm).
create view dashboard_source_coverage as
  select cf.firm_key, src as source,
         count(*) as companies,
         count(*) filter (where cardinality(cf.sources) = 1) as only_this_source
  from roster_counted cf, unnest(cf.sources) src
  group by cf.firm_key, src;

-- ───────────────────────── Access ─────────────────────────
alter table firms enable row level security;
alter table companies enable row level security;
alter table company_firms enable row level security;
alter table funding_rounds enable row level security;
alter table company_snapshots enable row level security;
alter table application_events enable row level security;
alter table source_records enable row level security;
alter table workflow_runs enable row level security;
-- Clay writes with the service role (bypasses RLS). The sync uses a read-only role that can see only the views.
create role dashboard_reader nologin;
grant usage on schema public to dashboard_reader;
grant select on dashboard_companies, dashboard_firms, dashboard_source_coverage, workflow_runs to dashboard_reader;
