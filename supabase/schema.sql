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
  salesforce_account_id   text,                      -- from the read-only Snowflake lookup
  sales_tier              text,                      -- 'Tier 1'..'Tier 4'
  sales_owned             boolean,                   -- an AE owns the account or there's an open opportunity: route to sales, not ads
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

-- ───────────────────────── Outreach and ad audiences ─────────────────────────
-- People at portfolio companies we could reach. Personal data: stays in Supabase, never in dashboard views.
create table contacts (
  contact_id      uuid primary key default gen_random_uuid(),
  company_key     text not null references companies on update cascade,
  full_name       text,
  title           text,
  persona         text check (persona in ('founder', 'gtm_leader', 'revops', 'growth', 'other')),
  linkedin_url    text unique,
  email           text unique,
  email_status    text check (email_status in ('verified', 'catch_all', 'unverified', 'invalid')),
  source          text not null,             -- provider / waterfall step that found them
  opted_out       boolean not null default false,
  found_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- An audience = a named, rule-based list pushed to one channel (an ad platform or an outbound sequence).
create table audiences (
  audience_key    text primary key,          -- e.g. 'li_seed_a_not_on_clay'
  name            text not null,
  channel         text not null check (channel in ('linkedin_ads', 'meta_ads', 'google_ads', 'email_sequence', 'linkedin_outreach')),
  member_type     text not null check (member_type in ('company', 'contact')),
  rule            text not null,             -- plain-language rule, e.g. 'Eligible, not on Clay, not sales-owned'
  holdout_pct     numeric not null default 0.1,   -- share of matching members kept out, to measure lift
  platform_audience_id text,                 -- id in the ad platform once created
  created_at      timestamptz not null default now()
);

-- Membership history: who was in which audience when, and who was held out.
create table audience_members (
  audience_key    text not null references audiences on update cascade,
  company_key     text not null references companies on update cascade,
  contact_id      uuid references contacts on delete set null,   -- null for company-level audiences
  is_holdout      boolean not null default false,
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,
  removed_reason  text,                      -- 'converted', 'became_paid', 'sales_owned', 'opted_out', 'rule_changed'
  pushed_at       timestamptz,               -- last sync to the platform
  primary key (audience_key, company_key, added_at)
);

-- Every outbound touch, for suppression ("not contacted in the last 30 days") and attribution.
create table outreach_touches (
  touch_id        bigint generated always as identity primary key,
  company_key     text not null references companies on update cascade,
  contact_id      uuid references contacts on delete set null,
  channel         text not null check (channel in ('email', 'linkedin', 'partner_intro', 'event')),
  campaign        text,                      -- utm_campaign used in the links, per the UTM channel rules
  touched_at      timestamptz not null,
  outcome         text check (outcome in ('sent', 'bounced', 'replied', 'meeting', 'unsubscribed')),
  sent_by         text                       -- tool or owner
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
-- No contact fields (poc_*, applicant_email, contacts.*) appear below: only counts of reachable contacts.

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

-- One row per company: the single next action, and why. This is the outreach / audience queue.
create view dashboard_targets as
  with c as (
    select d.company_key, min(d.name) as name, min(d.domain) as domain, bool_or(d.is_stealth) as is_stealth,
           array_agg(distinct d.firm_key) as firms, bool_or(f.partner_status in ('partner', 'proven_partner')) as partner_backed,
           max(d.funding_stage) as funding_stage, max(d.last_round_at) as last_round_at,
           max(d.headcount) as headcount, max(d.headcount_growth_6m_pct) as headcount_growth_6m_pct,
           max(d.opportunity_score) as opportunity_score, bool_or(d.is_eligible) as is_eligible,
           max(d.company_fit) as company_fit, max(d.net_new_check) as net_new_check
    from dashboard_companies d join firms f using (firm_key)
    where d.in_denominator
    group by d.company_key
  ), s as (select company_key, clay_account, sales_owned, sales_tier from latest_snapshots),
  k as (select company_key, count(*) filter (where not opted_out and (email_status = 'verified' or linkedin_url is not null)) as reachable_contacts
        from contacts group by company_key),
  t as (select company_key, max(touched_at) as last_touched_at from outreach_touches group by company_key),
  a as (select company_key, array_agg(distinct audience_key) filter (where not is_holdout) as audiences,
               bool_or(is_holdout) as in_holdout
        from audience_members where removed_at is null group by company_key)
  select c.*, s.clay_account, s.sales_owned, s.sales_tier,
         coalesce(k.reachable_contacts, 0) as reachable_contacts, t.last_touched_at,
         coalesce(a.audiences, '{}') as audiences, coalesce(a.in_holdout, false) as in_holdout,
         case
           when s.clay_account = 'paid'                           then 'none: already paying'
           when s.sales_owned                                     then 'route to sales'
           when c.company_fit = 'not_eligible'                    then 'none: not eligible'
           when c.company_fit = 'unknown'                         then 'research'
           when c.net_new_check = 'needs_check'                   then 'lifecycle nudge (has a free workspace)'
           when coalesce(a.in_holdout, false)                     then 'hold out'
           when t.last_touched_at > now() - interval '30 days'   then 'wait: contacted recently'
           when coalesce(k.reachable_contacts, 0) > 0             then 'email / LinkedIn outreach'
           else 'ad audience (company list)'
         end as next_action
  from c left join s using (company_key) left join k using (company_key) left join t using (company_key) left join a using (company_key);

-- Audience sizes by channel (platforms have minimum match sizes, so watch these).
create view dashboard_audiences as
  select au.audience_key, au.name, au.channel, au.member_type, au.rule, au.holdout_pct,
         count(*) filter (where m.removed_at is null and not m.is_holdout) as active_members,
         count(*) filter (where m.removed_at is null and m.is_holdout)     as holdout_members,
         count(*) filter (where m.removed_reason = 'converted')            as converted,
         max(m.pushed_at) as last_pushed_at
  from audiences au left join audience_members m using (audience_key)
  group by au.audience_key;

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
alter table contacts enable row level security;
alter table audiences enable row level security;
alter table audience_members enable row level security;
alter table outreach_touches enable row level security;
-- Clay writes with the service role (bypasses RLS). The sync uses a read-only role that can see only the views.
create role dashboard_reader nologin;
grant usage on schema public to dashboard_reader;
grant select on dashboard_companies, dashboard_firms, dashboard_targets, dashboard_audiences, dashboard_source_coverage, workflow_runs to dashboard_reader;
