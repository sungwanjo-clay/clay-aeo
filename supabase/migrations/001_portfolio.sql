-- Startup portfolio penetration: first migration (company-only).
-- Not applied anywhere yet. Tested locally with supabase/test/001_portfolio_test.sql.
--
-- Layout
--   portfolio  private tables (not exposed by the Supabase API). RLS on, no policies.
--   dashboard  read-only views for the dashboard sync (not exposed by the API either).
--   public     only the ingest function Clay calls: public.portfolio_ingest(key, kind, rows).
--
-- Identity: companies and firms have immutable uuids. Domains, slugs and provider ids live in
-- *_identifiers tables, so a stealth company getting a domain or a firm renaming keeps its history.
--
-- Access
--   Clay      calls public.portfolio_ingest with the project's anon key plus its own ingest key
--             (stored hashed in portfolio.ingest_keys). It cannot read or write any table directly.
--   Sync      logs in as dashboard_sync over a direct database connection and can read only `dashboard`.
--
-- Deferred to later migrations: contacts, applications, audiences, outreach history, funding rounds.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists portfolio;
create schema if not exists dashboard;

-- ───────────────────────── Reference: which sources count toward the denominator ─────────────────────────
create table portfolio.sources (
  source                     text primary key,
  counts_toward_denominator  boolean not null,
  description                text not null
);
insert into portfolio.sources values
  ('harmonic',        true,  'Harmonic investor portfolio or company investors'),
  ('pitchbook',       true,  'PitchBook fund or investor portfolio'),
  ('crunchbase',      true,  'Crunchbase investments'),
  ('dealroom',        true,  'Dealroom investors'),
  ('yc_directory',    true,  'ycombinator.com/companies (official accelerator roster)'),
  ('portfolio_page',  true,  'The firm''s own portfolio page'),
  ('partner_list',    true,  'A roster the firm shared with us'),
  ('announcement',    true,  'Funding announcement or press (incl. found via Google / Claygent research)'),
  ('workspace_match', false, 'Found by starting from our own Clay workspaces; an audit of roster gaps only');

-- ───────────────────────── Firms ─────────────────────────
create table portfolio.firms (
  firm_id               uuid primary key default gen_random_uuid(),
  name                  text not null,
  firm_type             text not null default 'vc_fund' check (firm_type in ('vc_fund', 'accelerator', 'other')),
  -- The sheet's three facts, kept separate:
  partner_checkbox      boolean,          -- "Partner" column on All Priority (null = firm not on that tab)
  on_proven_tab         boolean not null default false,
  on_to_approve_tab     boolean not null default false,
  stage_focus           text,
  is_multi_stage        boolean not null default false,
  sector_focus          text,
  region                text,
  outreached            boolean,
  referral_url          text,
  referral_utm_campaign text,
  referral_utm_medium   text,
  portfolio_url         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table portfolio.firm_identifiers (
  firm_id     uuid not null references portfolio.firms on delete cascade,
  id_type     text not null check (id_type in ('sheet_name', 'harmonic', 'pitchbook', 'crunchbase', 'dealroom', 'domain')),
  value       text not null,               -- normalized: lowercase, trimmed
  first_seen_at timestamptz not null default now(),
  primary key (id_type, value)
);

-- ───────────────────────── Companies ─────────────────────────
create table portfolio.companies (
  company_id      uuid primary key default gen_random_uuid(),
  name            text not null,
  is_stealth      boolean not null default false,
  description     text,
  industry        text,
  hq_country      text,
  hq_city         text,
  founded_year    int,
  website_status  text check (website_status in ('live', 'parked', 'down', 'none')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table portfolio.company_identifiers (
  company_id    uuid not null references portfolio.companies on delete cascade,
  id_type       text not null check (id_type in ('domain', 'harmonic', 'pitchbook', 'crunchbase', 'dealroom', 'yc_slug', 'linkedin', 'stealth_name')),
  value         text not null,               -- normalized: domain without www/protocol/path, ids lowercased
  first_seen_at timestamptz not null default now(),
  retired_at    timestamptz,                 -- e.g. an old domain; still used for matching, not shown as current
  primary key (company_id, id_type, value)
);
create index on portfolio.company_identifiers (company_id);
-- Real identifiers are unique across companies; stealth names may repeat (two firms' "Stealth Co").
create unique index company_identifiers_unique on portfolio.company_identifiers (id_type, value) where id_type <> 'stealth_name';

-- ───────────────────────── Roster: company × firm, and the dated evidence behind it ─────────────────────────
create table portfolio.company_firms (
  relationship_id      uuid primary key default gen_random_uuid(),
  company_id           uuid not null references portfolio.companies on delete cascade,
  firm_id              uuid not null references portfolio.firms on delete cascade,
  relationship         text check (relationship in ('investor', 'lead_investor', 'cohort')),
  round_or_batch       text,                 -- 'seed', 'series_a', or a YC batch like 'W25'
  invested_at          date,                 -- investment or cohort date (YC: batch, not launch date)
  verification_status  text not null default 'review' check (verification_status in ('verified', 'review', 'rejected', 'removed')),
  verification_note    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, firm_id)
);

create table portfolio.relationship_evidence (
  evidence_id       bigint generated always as identity primary key,
  relationship_id   uuid not null references portfolio.company_firms on delete cascade,
  source            text not null references portfolio.sources,
  source_ref        text not null,           -- provider record id, else the evidence URL; makes retries idempotent
  evidence_url      text,
  relationship      text,                    -- as this source reports it
  round_or_batch    text,
  invested_at       date,
  first_observed_at timestamptz not null,    -- never changed after insert
  last_observed_at  timestamptz not null,    -- latest run that still saw it
  run_id            uuid,
  payload           jsonb not null default '{}'::jsonb,   -- raw record as the source returned it
  unique (relationship_id, source, source_ref)
);

-- Rows the ingest couldn't place (unknown firm, ambiguous company, unknown source). Resolved by hand.
create table portfolio.match_review (
  review_id    bigint generated always as identity primary key,
  kind         text not null,
  reason       text not null,
  row_data     jsonb not null,
  candidates   uuid[],
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolution   text
);

-- ───────────────────────── Weekly snapshots (append-only history) ─────────────────────────
create table portfolio.company_snapshots (
  snapshot_date           date not null,
  company_id              uuid not null references portfolio.companies on delete cascade,
  funding_stage           text,
  last_round_at           date,
  last_round_amount_usd   numeric,
  total_raised_usd        numeric,
  is_vc_backed            boolean,
  headcount               int,
  headcount_growth_6m_pct numeric,
  funding_fit             text not null check (funding_fit in ('fits', 'does_not_fit', 'unknown')),  -- funding only: Seed/Series A + VC-backed
  funding_fit_reason      text,
  clay_account            text check (clay_account in ('none', 'free', 'paid', 'unknown')),           -- as of the snapshot
  net_new_check           text not null check (net_new_check in ('pass', 'fail', 'needs_check')),
  net_new_reason          text,
  offer_tier_credits      int,
  opportunity_score       numeric,
  score_drivers           jsonb,
  data_gaps               text[] not null default '{}',
  run_id                  uuid,
  recorded_at             timestamptz not null default now(),
  primary key (snapshot_date, company_id)
);

-- ───────────────────────── Runs ─────────────────────────
create table portfolio.workflow_runs (
  run_id       uuid primary key,
  workflow     text not null check (workflow in ('firms', 'roster', 'snapshot')),
  firm_id      uuid references portfolio.firms on delete set null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  status       text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  counts       jsonb,
  error        text
);

-- ───────────────────────── Ingest keys (hashed) ─────────────────────────
create table portfolio.ingest_keys (
  key_name    text primary key,
  key_hash    text not null,                 -- extensions.crypt(key, extensions.gen_salt('bf'))
  kinds       text[] not null,               -- which kinds this key may write
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- RLS on everything, no policies: even an accidental grant to anon/authenticated returns nothing.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'portfolio' loop
    execute format('alter table portfolio.%I enable row level security', t);
  end loop;
end $$;

-- ═════════════════════════ Ingest ═════════════════════════
create function portfolio.norm_domain(v text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(lower(trim(coalesce(v, ''))), '^[a-z]+://', ''), '^www\.', ''), '[/?#].*$', ''), '')
$$;
create function portfolio.norm_id(v text) returns text language sql immutable as $$
  select nullif(lower(trim(coalesce(v, ''))), '')
$$;
create function portfolio.norm_linkedin(v text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(lower(trim(coalesce(v, ''))), '^[a-z]+://(www\.)?', ''), '/+$', ''), '')
$$;

-- Identifiers carried by a row: [{id_type, value}], normalized.
create function portfolio.row_identifiers(r jsonb) returns table (id_type text, value text) language sql immutable as $$
  select * from (values
    ('domain',     portfolio.norm_domain(r->>'domain')),
    ('harmonic',   portfolio.norm_id(r->>'harmonic_id')),
    ('pitchbook',  portfolio.norm_id(r->>'pitchbook_id')),
    ('crunchbase', portfolio.norm_id(r->>'crunchbase_slug')),
    ('dealroom',   portfolio.norm_id(r->>'dealroom_id')),
    ('yc_slug',    portfolio.norm_id(r->>'yc_slug')),
    ('linkedin',   portfolio.norm_linkedin(r->>'linkedin_url'))
  ) v(id_type, value) where value is not null
$$;

-- Find or create the company a row describes. Returns null (and files a review row) when ambiguous.
-- A stealth company first seen with only a name is matched by that name within the same firm, so a later
-- source that adds a Crunchbase id or a domain attaches to it instead of creating a second company.
create function portfolio.resolve_company(r jsonb, create_if_missing boolean, kind text, p_firm uuid default null) returns uuid
language plpgsql as $$
declare ids uuid[]; cid uuid; nm text := nullif(trim(r->>'company_name'), '');
begin
  select array_agg(distinct ci.company_id) into ids
  from portfolio.row_identifiers(r) x join portfolio.company_identifiers ci using (id_type, value);

  if ids is null and nm is not null then
    select array_agg(distinct ci.company_id) into ids
    from portfolio.company_identifiers ci
    where ci.id_type = 'stealth_name' and ci.value = lower(nm)
      and (p_firm is null or exists (select 1 from portfolio.company_firms cf where cf.company_id = ci.company_id and cf.firm_id = p_firm));
  end if;

  if cardinality(ids) > 1 then
    insert into portfolio.match_review (kind, reason, row_data, candidates) values (kind, 'ambiguous_company', r, ids);
    return null;
  end if;
  cid := ids[1];

  if cid is null then
    if not create_if_missing or nm is null then
      insert into portfolio.match_review (kind, reason, row_data)
      values (kind, case when create_if_missing then 'no_company_name' else 'unknown_company' end, r);
      return null;
    end if;
    insert into portfolio.companies (name, is_stealth) values (nm, portfolio.norm_domain(r->>'domain') is null) returning company_id into cid;
    if portfolio.norm_domain(r->>'domain') is null then
      insert into portfolio.company_identifiers (company_id, id_type, value) values (cid, 'stealth_name', lower(nm));
    end if;
  end if;

  -- Attach any new identifiers (a stealth company gaining a domain keeps its company_id).
  insert into portfolio.company_identifiers (company_id, id_type, value)
  select cid, x.id_type, x.value from portfolio.row_identifiers(r) x
  where not exists (select 1 from portfolio.company_identifiers ci where ci.id_type = x.id_type and ci.value = x.value);
  if portfolio.norm_domain(r->>'domain') is not null then
    update portfolio.companies set is_stealth = false, updated_at = now() where company_id = cid and is_stealth;
  end if;
  return cid;
end $$;

create function portfolio.resolve_firm(r jsonb) returns uuid language sql stable as $$
  select firm_id from portfolio.firm_identifiers
  where id_type = 'sheet_name' and value = portfolio.norm_id(r->>'firm')
$$;

create function portfolio.ingest_firms(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; n_new int := 0; n_upd int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    if portfolio.norm_id(r->>'firm') is null then
      insert into portfolio.match_review (kind, reason, row_data) values ('firms', 'no_firm_name', r); continue;
    end if;
    fid := portfolio.resolve_firm(r);
    if fid is null then
      insert into portfolio.firms (name) values (trim(r->>'firm')) returning firm_id into fid;
      insert into portfolio.firm_identifiers (firm_id, id_type, value) values (fid, 'sheet_name', portfolio.norm_id(r->>'firm'));
      n_new := n_new + 1;
    else
      n_upd := n_upd + 1;
    end if;
    -- Only keys present in the row are changed, so each sheet tab can be loaded on its own.
    update portfolio.firms f set
      firm_type             = case when r ? 'firm_type' then r->>'firm_type' else f.firm_type end,
      partner_checkbox      = case when r ? 'partner_checkbox' then (r->>'partner_checkbox')::boolean else f.partner_checkbox end,
      on_proven_tab         = case when r ? 'on_proven_tab' then (r->>'on_proven_tab')::boolean else f.on_proven_tab end,
      on_to_approve_tab     = case when r ? 'on_to_approve_tab' then (r->>'on_to_approve_tab')::boolean else f.on_to_approve_tab end,
      stage_focus           = case when r ? 'stage_focus' then r->>'stage_focus' else f.stage_focus end,
      is_multi_stage        = case when r ? 'stage_focus' then coalesce(r->>'stage_focus', '') ilike '%multi-stage%' else f.is_multi_stage end,
      sector_focus          = case when r ? 'sector_focus' then r->>'sector_focus' else f.sector_focus end,
      region                = case when r ? 'region' then r->>'region' else f.region end,
      outreached            = case when r ? 'outreached' then (r->>'outreached')::boolean else f.outreached end,
      referral_url          = case when r ? 'referral_url' then r->>'referral_url' else f.referral_url end,
      referral_utm_campaign = case when r ? 'referral_url' then substring(r->>'referral_url' from 'utm_campaign=([^&#]+)') else f.referral_utm_campaign end,
      referral_utm_medium   = case when r ? 'referral_url' then substring(r->>'referral_url' from 'utm_medium=([^&#]+)') else f.referral_utm_medium end,
      portfolio_url         = case when r ? 'portfolio_url' then r->>'portfolio_url' else f.portfolio_url end,
      updated_at            = now()
    where f.firm_id = fid;
    insert into portfolio.firm_identifiers (firm_id, id_type, value)
    select fid, t, v from (values ('harmonic', portfolio.norm_id(r->>'harmonic_investor_id')), ('pitchbook', portfolio.norm_id(r->>'pitchbook_investor_id')),
                                  ('crunchbase', portfolio.norm_id(r->>'crunchbase_slug')), ('dealroom', portfolio.norm_id(r->>'dealroom_id')),
                                  ('domain', portfolio.norm_domain(r->>'domain'))) x(t, v)
    where v is not null on conflict do nothing;
  end loop;
  return jsonb_build_object('firms_new', n_new, 'firms_updated', n_upd);
end $$;

create function portfolio.ingest_roster(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; cid uuid; rid uuid; ref text; obs timestamptz; ins boolean;
        n_rel int := 0; n_ev_new int := 0; n_ev_seen int := 0; n_review int := 0; n_comp_before int;
begin
  select count(*) into n_comp_before from portfolio.companies;
  for r in select * from jsonb_array_elements(rows) loop
    if not exists (select 1 from portfolio.sources where source = r->>'source') then
      insert into portfolio.match_review (kind, reason, row_data) values ('roster', 'unknown_source', r); n_review := n_review + 1; continue;
    end if;
    fid := portfolio.resolve_firm(r);
    if fid is null then
      insert into portfolio.match_review (kind, reason, row_data) values ('roster', 'unknown_firm', r); n_review := n_review + 1; continue;
    end if;
    cid := portfolio.resolve_company(r, true, 'roster', fid);
    if cid is null then n_review := n_review + 1; continue; end if;

    insert into portfolio.company_firms (company_id, firm_id, relationship, round_or_batch, invested_at)
    values (cid, fid, r->>'relationship', r->>'round_or_batch', (r->>'invested_at')::date)
    on conflict (company_id, firm_id) do nothing
    returning relationship_id into rid;
    if rid is not null then
      n_rel := n_rel + 1;
    else
      select relationship_id into rid from portfolio.company_firms where company_id = cid and firm_id = fid;
      -- Fill gaps only; never overwrite what's there.
      update portfolio.company_firms set
        relationship   = coalesce(relationship, r->>'relationship'),
        round_or_batch = coalesce(round_or_batch, r->>'round_or_batch'),
        invested_at    = coalesce(invested_at, (r->>'invested_at')::date),
        updated_at     = now()
      where relationship_id = rid;
    end if;
    if r ? 'verification_status' then
      update portfolio.company_firms set verification_status = r->>'verification_status', verification_note = coalesce(r->>'verification_note', verification_note), updated_at = now()
      where relationship_id = rid;
    end if;

    ref := coalesce(nullif(r->>'source_ref', ''), nullif(r->>'evidence_url', ''), '');
    obs := coalesce((r->>'observed_at')::timestamptz, now());
    insert into portfolio.relationship_evidence
      (relationship_id, source, source_ref, evidence_url, relationship, round_or_batch, invested_at, first_observed_at, last_observed_at, run_id, payload)
    values (rid, r->>'source', ref, r->>'evidence_url', r->>'relationship', r->>'round_or_batch', (r->>'invested_at')::date, obs, obs,
            (r->>'run_id')::uuid, coalesce(r->'payload', '{}'::jsonb))
    on conflict (relationship_id, source, source_ref) do update
      set last_observed_at = greatest(portfolio.relationship_evidence.last_observed_at, excluded.last_observed_at),
          run_id = coalesce(excluded.run_id, portfolio.relationship_evidence.run_id)
    returning (xmax = 0) into ins;
    if ins then n_ev_new := n_ev_new + 1; else n_ev_seen := n_ev_seen + 1; end if;
  end loop;
  return jsonb_build_object('companies_new', (select count(*) from portfolio.companies) - n_comp_before, 'relationships_new', n_rel,
                            'evidence_new', n_ev_new, 'evidence_seen_again', n_ev_seen, 'sent_to_review', n_review);
end $$;

create function portfolio.ingest_snapshots(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; cid uuid; n int := 0; n_review int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    cid := portfolio.resolve_company(r, false, 'snapshot');
    if cid is null then n_review := n_review + 1; continue; end if;
    -- Re-running the same week replaces that week's row; other weeks are never touched.
    insert into portfolio.company_snapshots (snapshot_date, company_id, funding_stage, last_round_at, last_round_amount_usd, total_raised_usd,
      is_vc_backed, headcount, headcount_growth_6m_pct, funding_fit, funding_fit_reason, clay_account, net_new_check, net_new_reason,
      offer_tier_credits, opportunity_score, score_drivers, data_gaps, run_id)
    values ((r->>'snapshot_date')::date, cid, r->>'funding_stage', (r->>'last_round_at')::date, (r->>'last_round_amount_usd')::numeric,
      (r->>'total_raised_usd')::numeric, (r->>'is_vc_backed')::boolean, (r->>'headcount')::int, (r->>'headcount_growth_6m_pct')::numeric,
      r->>'funding_fit', r->>'funding_fit_reason', r->>'clay_account', r->>'net_new_check', r->>'net_new_reason',
      (r->>'offer_tier_credits')::int, (r->>'opportunity_score')::numeric, r->'score_drivers',
      coalesce(array(select jsonb_array_elements_text(r->'data_gaps')), '{}'), (r->>'run_id')::uuid)
    on conflict (snapshot_date, company_id) do update set
      funding_stage = excluded.funding_stage, last_round_at = excluded.last_round_at, last_round_amount_usd = excluded.last_round_amount_usd,
      total_raised_usd = excluded.total_raised_usd, is_vc_backed = excluded.is_vc_backed, headcount = excluded.headcount,
      headcount_growth_6m_pct = excluded.headcount_growth_6m_pct, funding_fit = excluded.funding_fit, funding_fit_reason = excluded.funding_fit_reason,
      clay_account = excluded.clay_account, net_new_check = excluded.net_new_check, net_new_reason = excluded.net_new_reason,
      offer_tier_credits = excluded.offer_tier_credits, opportunity_score = excluded.opportunity_score, score_drivers = excluded.score_drivers,
      data_gaps = excluded.data_gaps, run_id = excluded.run_id, recorded_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('snapshots_written', n, 'sent_to_review', n_review);
end $$;

create function portfolio.ingest_runs(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    insert into portfolio.workflow_runs (run_id, workflow, firm_id, started_at, finished_at, status, counts, error)
    values ((r->>'run_id')::uuid, r->>'workflow', portfolio.resolve_firm(r), coalesce((r->>'started_at')::timestamptz, now()),
            (r->>'finished_at')::timestamptz, r->>'status', r->'counts', r->>'error')
    on conflict (run_id) do update set finished_at = excluded.finished_at, status = excluded.status,
      counts = coalesce(excluded.counts, portfolio.workflow_runs.counts), error = excluded.error;
    n := n + 1;
  end loop;
  return jsonb_build_object('runs_written', n);
end $$;

-- The one function Clay calls (POST /rest/v1/rpc/portfolio_ingest).
-- kind: 'firms' | 'roster' | 'snapshots' | 'runs'; rows: a JSON array (keep batches ≤ 500 rows).
create function public.portfolio_ingest(p_key text, p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not exists (select 1 from portfolio.ingest_keys k
                 where k.revoked_at is null and p_kind = any (k.kinds) and k.key_hash = extensions.crypt(p_key, k.key_hash)) then
    raise exception 'invalid ingest key for %', p_kind using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'at most 1000 rows per call'; end if;
  return case p_kind
    when 'firms'     then portfolio.ingest_firms(p_rows)
    when 'roster'    then portfolio.ingest_roster(p_rows)
    when 'snapshots' then portfolio.ingest_snapshots(p_rows)
    when 'runs'      then portfolio.ingest_runs(p_rows)
    else null end;
end $$;

-- ═════════════════════════ Dashboard views (the sync reads only these) ═════════════════════════
create view dashboard.firms as
  select f.firm_id, f.name, f.firm_type, f.partner_checkbox, f.on_proven_tab, f.on_to_approve_tab,
         f.stage_focus, f.is_multi_stage, f.sector_focus, f.region, f.outreached, f.referral_utm_campaign, f.referral_utm_medium,
         (select max(finished_at) from portfolio.workflow_runs w where w.firm_id = f.firm_id and w.workflow = 'roster' and w.status = 'succeeded') as roster_refreshed_at
  from portfolio.firms f;

-- One row per company × firm. in_denominator = verified AND at least one source that counts.
create view dashboard.roster as
  with ev as (
    select e.relationship_id,
           array_agg(distinct e.source order by e.source) as sources,
           array_agg(distinct e.source order by e.source) filter (where s.counts_toward_denominator) as qualifying_sources,
           min(e.first_observed_at) filter (where s.counts_toward_denominator) as first_qualified_at,
           bool_or(e.source = 'partner_list') as shared_by_partner,
           max(e.last_observed_at) as last_observed_at,
           (array_agg(e.evidence_url order by s.counts_toward_denominator desc, e.first_observed_at) filter (where e.evidence_url is not null))[1] as evidence_url
    from portfolio.relationship_evidence e join portfolio.sources s using (source)
    group by e.relationship_id
  )
  select cf.relationship_id, cf.company_id, cf.firm_id, cf.relationship, cf.round_or_batch, cf.invested_at,
         cf.verification_status, coalesce(ev.sources, '{}') as sources, coalesce(ev.qualifying_sources, '{}') as qualifying_sources,
         ev.first_qualified_at, coalesce(ev.shared_by_partner, false) as shared_by_partner, ev.last_observed_at, ev.evidence_url,
         (cf.verification_status = 'verified' and ev.first_qualified_at is not null) as in_denominator
  from portfolio.company_firms cf left join ev using (relationship_id);

-- One row per company. Domains (current and retired) are what the dashboard matches against Snowflake.
create view dashboard.companies as
  select c.company_id, c.name, c.is_stealth, c.industry, c.hq_country, c.created_at as first_seen_at,
         (select ci.value from portfolio.company_identifiers ci where ci.company_id = c.company_id and ci.id_type = 'domain' and ci.retired_at is null
           order by ci.first_seen_at desc limit 1) as domain,
         coalesce((select array_agg(ci.value order by ci.first_seen_at) from portfolio.company_identifiers ci
           where ci.company_id = c.company_id and ci.id_type = 'domain'), '{}') as all_domains,
         (select ci.value from portfolio.company_identifiers ci where ci.company_id = c.company_id and ci.id_type = 'linkedin' limit 1) as linkedin
  from portfolio.companies c;

-- Latest snapshot per company, plus the dates the cumulative redemption denominator needs.
create view dashboard.company_status as
  select s.company_id, s.snapshot_date, s.funding_stage, s.last_round_at, s.last_round_amount_usd, s.total_raised_usd, s.is_vc_backed,
         s.headcount, s.headcount_growth_6m_pct, s.funding_fit, s.funding_fit_reason, s.clay_account, s.net_new_check, s.net_new_reason,
         s.offer_tier_credits, s.opportunity_score, s.score_drivers, s.data_gaps,
         h.first_funding_fit_at, h.first_eligible_at
  from (select distinct on (company_id) * from portfolio.company_snapshots order by company_id, snapshot_date desc) s
  join (select company_id,
               min(snapshot_date) filter (where funding_fit = 'fits') as first_funding_fit_at,
               min(snapshot_date) filter (where funding_fit = 'fits' and net_new_check = 'pass') as first_eligible_at   -- enters the cumulative eligible cohort
        from portfolio.company_snapshots group by company_id) h using (company_id);

-- Per firm × source: verified companies found, and how many no other source found.
create view dashboard.source_coverage as
  select r.firm_id, src as source, count(*) as companies,
         count(*) filter (where cardinality(r.sources) = 1) as only_this_source
  from dashboard.roster r, unnest(r.sources) src
  where r.verification_status = 'verified'
  group by r.firm_id, src;

create view dashboard.review_queue as
  select kind, reason, count(*) as open_rows, min(created_at) as oldest
  from portfolio.match_review where resolved_at is null group by kind, reason;

-- ═════════════════════════ Grants ═════════════════════════
-- Nothing in portfolio/dashboard for the API roles. (On Supabase these roles exist; locally the test creates them.)
revoke all on schema portfolio, dashboard from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema portfolio, dashboard from anon, authenticated';
    execute 'revoke all on all tables in schema portfolio, dashboard from anon, authenticated';
  end if;
end $$;
-- Functions: only the ingest entry point is callable from the API.
revoke execute on all functions in schema portfolio from public;
revoke execute on function public.portfolio_ingest(text, text, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.portfolio_ingest(text, text, jsonb) from anon, authenticated';
    execute 'grant execute on function public.portfolio_ingest(text, text, jsonb) to anon';
  end if;
end $$;

-- The sync's login. Set its password out of band:  alter role dashboard_sync password '…';
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'dashboard_sync') then
    create role dashboard_sync login;
  end if;
end $$;
grant usage on schema dashboard to dashboard_sync;
grant select on all tables in schema dashboard to dashboard_sync;
