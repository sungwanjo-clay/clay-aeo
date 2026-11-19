-- 004: saved state for incremental weekly discovery. Applies on top of 003. Not applied anywhere yet.
--
-- What the weekly run needs from last time, per firm:
--   * the firm's resolved identity (so it isn't re-researched every week),
--   * its official announcement sources and a checkpoint (read only what's new, with an overlap),
--   * every known company with its latest verification and the signals it was verified against
--     (so only new companies, or known ones with a new signal, are re-verified),
--   * per-source run status (so a failed source is never read as "zero companies").
--
-- New ingest kinds (via public.portfolio_ingest_h, the writer key):
--   firm_identity   [{firm, official_name, firm_domain, firm_type, aliases[], alias_collisions[], crunchbase_url,
--                     linkedin_url, x_url, portfolio_url, identity_confidence, checked_at?}]
--   firm_sources    [{firm, url, source_type, status?, outcome? ('ok'|'failed'|'partial'), last_success_at?, last_failure_at?,
--                     checkpoint_date?, checkpoint_url?, and, when (re)discovered, the recipe: method, list_url, needs_js,
--                     link_pattern, profile_pattern, expected_count, last_count, recipe_notes}]
--                   A failed outcome marks the source broken; the next run rediscovers its recipe.
--   verifications   [{firm, <company identifiers>, company_name, backing, relationship, backing_source_url,
--                     latest_round_type, latest_round_date, latest_round_amount_usd, latest_round_leads,
--                     latest_round_source_url, firm_in_latest_round, signal_key, verified_at?, run_id?}]
--   source_runs     [{run_id, firm, source, status, companies, new_companies, cap_hit, checkpoint, error}]
-- New read entry point for Clay (separate read key in its own header):
--   POST /rest/v1/rpc/portfolio_state_h   body {"p_firm": "<firm as in the sheet>"}   header x-portfolio-key (the existing Clay
--   writer connection, granted 'state' below) or x-portfolio-read-key

-- ───────────────────────── Firm identity cache ─────────────────────────
alter table portfolio.firms
  add column official_name        text,
  add column aliases              text[] not null default '{}',
  add column alias_collisions     text[] not null default '{}',
  add column crunchbase_url       text,
  add column linkedin_url         text,
  add column x_url                text,
  add column identity_confidence  text,
  add column identity_checked_at  timestamptz;

-- ───────────────────────── Official announcement sources + checkpoints ─────────────────────────
create table portfolio.firm_sources (
  firm_id          uuid not null references portfolio.firms on delete cascade,
  url              text not null,
  source_type      text not null check (source_type in ('news', 'blog', 'press', 'portfolio_news', 'cohort', 'portfolio_directory', 'feed')),
  status           text not null default 'candidate' check (status in ('candidate', 'verified', 'broken', 'retired')),
  validated_at     timestamptz,
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  checkpoint_date  date,          -- newest announcement date seen on this source
  checkpoint_url   text,          -- newest announcement URL seen
  -- Recipe: how to read this source without research. Discovered once by Claygent, replayed by scrape steps.
  method           text check (method in ('sitemap', 'feed', 'static_html', 'js_html', 'profile_pages', 'agent_only')),
  list_url         text,          -- what to fetch (sitemap URL, directory page, feed)
  needs_js         boolean not null default false,
  link_pattern     text,          -- regex a company link must match (e.g. /companies/[a-z0-9-]+$), or 'external' for off-site company websites
  profile_pattern  text,          -- for profile-page directories: regex of a company profile URL
  expected_count   int,           -- total the site states, if any
  last_count       int,           -- companies the recipe returned last time it worked
  consecutive_failures int not null default 0,
  recipe_version   int not null default 0,
  recipe_notes     text,
  updated_at       timestamptz not null default now(),
  primary key (firm_id, url)
);

-- ───────────────────────── Verification results (latest + history) ─────────────────────────
create table portfolio.verifications (
  verification_id          bigint generated always as identity primary key,
  company_id               uuid not null references portfolio.companies on delete cascade,
  firm_id                  uuid not null references portfolio.firms on delete cascade,
  verified_at              timestamptz not null default now(),
  backing                  text not null check (backing in ('Confirmed', 'Not confirmed', 'Different firm', 'Unclear')),
  relationship             text,
  backing_source_url       text,
  latest_round_type        text,
  latest_round_date        text,          -- YYYY-MM-DD or YYYY-MM as the source gives it
  latest_round_amount_usd  numeric,
  latest_round_leads       text,
  latest_round_source_url  text,
  firm_in_latest_round     text check (firm_in_latest_round in ('Yes', 'No', 'Unknown')),
  signal_key               text,          -- the evidence fingerprint this was verified against; a change triggers re-verification
  run_id                   uuid
);
create index on portfolio.verifications (company_id, firm_id, verified_at desc);

-- ───────────────────────── Per-source run status ─────────────────────────
create table portfolio.source_runs (
  run_id         uuid not null,
  firm_id        uuid not null references portfolio.firms on delete cascade,
  source         text not null references portfolio.sources,
  status         text not null check (status in ('ok', 'no_new', 'capped', 'partial', 'failed', 'skipped')),
  companies      int,
  new_companies  int,
  cap_hit        boolean not null default false,
  checkpoint     text,
  error          text,
  recorded_at    timestamptz not null default now(),
  primary key (run_id, firm_id, source)
);

insert into portfolio.sources values
  ('official_portfolio', true, 'The firm''s own portfolio or company directory page'),
  ('google', true, 'Google search result, verified against the underlying article'),
  ('linkedin', true, 'The firm''s own LinkedIn posts'),
  ('x', true, 'The firm''s own X posts'),
  ('salesforce', false, 'Salesforce investor field; a lead until independently verified'),
  ('official_page', true, 'An announcement on the firm''s own website')
on conflict (source) do nothing;

do $$ declare t text; begin
  foreach t in array array['firm_sources', 'verifications', 'source_runs'] loop
    execute format('alter table portfolio.%I enable row level security', t);
  end loop;
end $$;

-- ═════════════════════════ Ingest ═════════════════════════
create function portfolio.jtext_array(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}')
$$;

create function portfolio.ingest_firm_identity(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; n int := 0; n_review int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    fid := portfolio.resolve_firm(r);
    if fid is null then insert into portfolio.match_review (kind, reason, row_data) values ('firm_identity', 'unknown_firm', r); n_review := n_review + 1; continue; end if;
    update portfolio.firms set
      official_name = coalesce(nullif(r->>'official_name', ''), official_name),
      firm_type = case when r->>'firm_type' ilike 'accel%' then 'accelerator' when r->>'firm_type' ilike 'vc%' then 'vc_fund' else firm_type end,
      aliases = case when r ? 'aliases' then portfolio.jtext_array(r->'aliases') else aliases end,
      alias_collisions = case when r ? 'alias_collisions' then portfolio.jtext_array(r->'alias_collisions') else alias_collisions end,
      crunchbase_url = coalesce(nullif(r->>'crunchbase_url', ''), crunchbase_url),
      linkedin_url = coalesce(nullif(r->>'linkedin_url', ''), linkedin_url),
      x_url = coalesce(nullif(r->>'x_url', ''), x_url),
      portfolio_url = coalesce(nullif(r->>'portfolio_url', ''), portfolio_url),
      identity_confidence = coalesce(nullif(r->>'identity_confidence', ''), identity_confidence),
      identity_checked_at = coalesce((r->>'checked_at')::timestamptz, now()),
      updated_at = now()
    where firm_id = fid;
    if portfolio.norm_domain(r->>'firm_domain') is not null then
      insert into portfolio.firm_identifiers (firm_id, id_type, value) values (fid, 'domain', portfolio.norm_domain(r->>'firm_domain')) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('firms_updated', n, 'sent_to_review', n_review);
end $$;

create function portfolio.ingest_firm_sources(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; n int := 0; n_review int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    fid := portfolio.resolve_firm(r);
    if fid is null or nullif(r->>'url', '') is null then
      insert into portfolio.match_review (kind, reason, row_data) values ('firm_sources', case when fid is null then 'unknown_firm' else 'no_url' end, r); n_review := n_review + 1; continue;
    end if;
    insert into portfolio.firm_sources as s (firm_id, url, source_type, status, validated_at, last_success_at, last_failure_at, checkpoint_date, checkpoint_url,
      method, list_url, needs_js, link_pattern, profile_pattern, expected_count, last_count, consecutive_failures, recipe_version, recipe_notes)
    values (fid, r->>'url', coalesce(r->>'source_type', 'news'), coalesce(r->>'status', 'candidate'), (r->>'validated_at')::timestamptz,
            (r->>'last_success_at')::timestamptz, (r->>'last_failure_at')::timestamptz, (r->>'checkpoint_date')::date, r->>'checkpoint_url',
            r->>'method', r->>'list_url', coalesce((r->>'needs_js')::boolean, false), r->>'link_pattern', r->>'profile_pattern',
            (r->>'expected_count')::int, (r->>'last_count')::int, case when r->>'outcome' = 'failed' then 1 else 0 end,
            case when r ? 'method' then 1 else 0 end, r->>'recipe_notes')
    on conflict (firm_id, url) do update set
      source_type = excluded.source_type,
      -- A new recipe (method sent) replaces the old one and bumps its version; an outcome updates health.
      method = coalesce(excluded.method, s.method), list_url = coalesce(excluded.list_url, s.list_url),
      needs_js = case when r ? 'needs_js' then excluded.needs_js else s.needs_js end,
      link_pattern = coalesce(excluded.link_pattern, s.link_pattern), profile_pattern = coalesce(excluded.profile_pattern, s.profile_pattern),
      expected_count = coalesce(excluded.expected_count, s.expected_count),
      last_count = case when r->>'outcome' = 'ok' then coalesce(excluded.last_count, s.last_count) else s.last_count end,
      recipe_version = s.recipe_version + case when r ? 'method' then 1 else 0 end,
      recipe_notes = coalesce(excluded.recipe_notes, s.recipe_notes),
      consecutive_failures = case when r->>'outcome' = 'failed' then s.consecutive_failures + 1
                                  when r->>'outcome' = 'ok' or r ? 'method' then 0 else s.consecutive_failures end,
      status = case when r ? 'status' then r->>'status'
                    when r ? 'method' and not r ? 'outcome' then 'candidate'
                    when r->>'outcome' = 'failed' and s.consecutive_failures + 1 >= 1 then 'broken'
                    when r->>'outcome' = 'ok' then 'verified' else s.status end,
      validated_at = coalesce(excluded.validated_at, s.validated_at),
      last_success_at = greatest(excluded.last_success_at, s.last_success_at),
      last_failure_at = greatest(excluded.last_failure_at, s.last_failure_at),
      -- A checkpoint only moves forward; a failed or partial read never rewinds it.
      checkpoint_date = greatest(excluded.checkpoint_date, s.checkpoint_date),
      checkpoint_url = case when excluded.checkpoint_date >= coalesce(s.checkpoint_date, excluded.checkpoint_date) then coalesce(excluded.checkpoint_url, s.checkpoint_url) else s.checkpoint_url end,
      updated_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('sources_written', n, 'sent_to_review', n_review);
end $$;

create function portfolio.ingest_verifications(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; cid uuid; rid uuid; n int := 0; n_review int := 0; ev_new int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    fid := portfolio.resolve_firm(r);
    if fid is null then insert into portfolio.match_review (kind, reason, row_data) values ('verification', 'unknown_firm', r); n_review := n_review + 1; continue; end if;
    if coalesce(r->>'backing', '') not in ('Confirmed', 'Not confirmed', 'Different firm', 'Unclear') then
      insert into portfolio.match_review (kind, reason, row_data) values ('verification', 'not_verified', r); n_review := n_review + 1; continue;
    end if;
    cid := portfolio.resolve_company(r, true, 'verification', fid);
    if cid is null then n_review := n_review + 1; continue; end if;
    insert into portfolio.verifications (company_id, firm_id, verified_at, backing, relationship, backing_source_url, latest_round_type, latest_round_date,
      latest_round_amount_usd, latest_round_leads, latest_round_source_url, firm_in_latest_round, signal_key, run_id)
    values (cid, fid, coalesce((r->>'verified_at')::timestamptz, now()), r->>'backing', r->>'relationship', r->>'backing_source_url',
      nullif(r->>'latest_round_type', ''), nullif(r->>'latest_round_date', ''), nullif((r->>'latest_round_amount_usd')::numeric, 0),
      nullif(r->>'latest_round_leads', ''), nullif(r->>'latest_round_source_url', ''),
      coalesce(nullif(r->>'firm_in_latest_round', ''), 'Unknown'), r->>'signal_key', (r->>'run_id')::uuid);
    -- Verification is itself evidence of the relationship: a confirmed one marks the link verified, a rejection marks it rejected.
    insert into portfolio.company_firms (company_id, firm_id, relationship)
    values (cid, fid, case r->>'relationship' when 'Lead investor' then 'lead_investor' when 'Accelerator cohort' then 'cohort' when 'Investor' then 'investor' end)
    on conflict (company_id, firm_id) do nothing;
    select relationship_id into rid from portfolio.company_firms where company_id = cid and firm_id = fid;
    update portfolio.company_firms set
      verification_status = case r->>'backing' when 'Confirmed' then 'verified' when 'Unclear' then 'review' else 'rejected' end,
      verification_note = left(coalesce(r->>'backing_source_url', ''), 500), updated_at = now()
    where relationship_id = rid;
    n := n + 1;
  end loop;
  return jsonb_build_object('verifications_written', n, 'sent_to_review', n_review);
end $$;

create function portfolio.ingest_source_runs(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; n int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    fid := portfolio.resolve_firm(r);
    if fid is null or not exists (select 1 from portfolio.sources where source = r->>'source') then
      insert into portfolio.match_review (kind, reason, row_data) values ('source_run', case when fid is null then 'unknown_firm' else 'unknown_source' end, r); continue;
    end if;
    insert into portfolio.source_runs (run_id, firm_id, source, status, companies, new_companies, cap_hit, checkpoint, error)
    values ((r->>'run_id')::uuid, fid, r->>'source', r->>'status', (r->>'companies')::int, (r->>'new_companies')::int,
            coalesce((r->>'cap_hit')::boolean, false), r->>'checkpoint', r->>'error')
    on conflict (run_id, firm_id, source) do update set status = excluded.status, companies = excluded.companies,
      new_companies = excluded.new_companies, cap_hit = excluded.cap_hit, checkpoint = excluded.checkpoint, error = excluded.error, recorded_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('source_runs_written', n);
end $$;

create or replace function public.portfolio_ingest(p_key text, p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not exists (select 1 from portfolio.ingest_keys k
                 where k.revoked_at is null and p_kind = any (k.kinds) and k.key_hash = extensions.crypt(p_key, k.key_hash)) then
    raise exception 'invalid ingest key for %', p_kind using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'at most 1000 rows per call'; end if;
  return case p_kind
    when 'firms'             then portfolio.ingest_firms(p_rows)
    when 'roster'            then portfolio.ingest_roster(p_rows)
    when 'snapshots'         then portfolio.ingest_snapshots(p_rows)
    when 'runs'              then portfolio.ingest_runs(p_rows)
    when 'snapshot_open'     then portfolio.ingest_snapshot_open(p_rows)
    when 'snapshot_close'    then portfolio.ingest_snapshot_close(p_rows)
    when 'snapshot_discard'  then portfolio.ingest_snapshot_discard(p_rows)
    when 'workspace_lookups' then portfolio.ingest_workspace_lookups(p_rows)
    when 'firm_identity'     then portfolio.ingest_firm_identity(p_rows)
    when 'firm_sources'      then portfolio.ingest_firm_sources(p_rows)
    when 'verifications'     then portfolio.ingest_verifications(p_rows)
    when 'source_runs'       then portfolio.ingest_source_runs(p_rows)
    else null end;
end $$;

update portfolio.ingest_keys set kinds = array(select distinct unnest(kinds || '{firm_identity,firm_sources,verifications,source_runs,state}'::text[]))
where key_name = 'clay-workflows';

-- ═════════════════════════ State for the weekly run ═════════════════════════
-- What Clay reads before discovering: identity, sources/checkpoints, and every known company for the firm
-- with its latest verification and when it was done. Read with a key whose kinds include 'state'.
create function portfolio.firm_state(p_firm text) returns jsonb language sql stable as $$
  with f as (select * from portfolio.firms where firm_id = portfolio.resolve_firm(jsonb_build_object('firm', p_firm))),
  latest as (
    select distinct on (v.company_id) v.* from portfolio.verifications v join f using (firm_id)
    order by v.company_id, v.verified_at desc),
  known as (
    select cf.company_id, c.name,
           (select ci.value from portfolio.company_identifiers ci where ci.company_id = c.company_id and ci.id_type = 'domain' and ci.retired_at is null order by ci.first_seen_at desc limit 1) as domain,
           cf.verification_status, l.verified_at, l.backing, l.relationship, l.backing_source_url, l.latest_round_type, l.latest_round_date,
           l.latest_round_amount_usd, l.latest_round_leads, l.latest_round_source_url, l.firm_in_latest_round, l.signal_key
    from portfolio.company_firms cf join f using (firm_id) join portfolio.companies c using (company_id)
    left join latest l using (company_id))
  select jsonb_build_object(
    'firm_known', exists (select 1 from f),
    'identity', (select jsonb_build_object('official_name', official_name, 'firm_type', firm_type, 'aliases', aliases, 'alias_collisions', alias_collisions,
                   'crunchbase_url', crunchbase_url, 'linkedin_url', linkedin_url, 'x_url', x_url, 'portfolio_url', portfolio_url,
                   'identity_confidence', identity_confidence, 'identity_checked_at', identity_checked_at,
                   'firm_domain', (select value from portfolio.firm_identifiers fi where fi.firm_id = f.firm_id and fi.id_type = 'domain' limit 1)) from f),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) - 'firm_id') from portfolio.firm_sources s join f using (firm_id) where s.status <> 'retired'), '[]'),
    'directory_read_at', (select max(sr.recorded_at) from portfolio.source_runs sr join f using (firm_id) where sr.source = 'official_portfolio' and sr.status in ('ok', 'no_new', 'partial')),
    'known_companies', coalesce((select jsonb_agg(to_jsonb(k)) from known k), '[]'),
    -- Directory profile pages already read (sitemaps often stamp every page with the same lastmod, so "seen" is the reliable test).
    'known_profile_urls', coalesce((select jsonb_agg(distinct e.source_ref) from portfolio.relationship_evidence e
                                     join portfolio.company_firms cf using (relationship_id) join f using (firm_id)
                                     where e.source = 'official_portfolio' and e.source_ref like 'http%'), '[]'),
    'known_count', (select count(*) from known))
$$;

create function public.portfolio_state_h(p_firm text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare h json := nullif(current_setting('request.headers', true), '')::json;
        k text := coalesce(h->>'x-portfolio-read-key', h->>'x-portfolio-key');   -- Clay's existing writer connection can read state too
begin
  if k is null or not exists (select 1 from portfolio.ingest_keys ik
                              where ik.revoked_at is null and 'state' = any (ik.kinds) and ik.key_hash = extensions.crypt(k, ik.key_hash)) then
    raise exception 'invalid read key' using errcode = '28000';
  end if;
  return portfolio.firm_state(p_firm);
end $$;

-- Dashboard views for the new tables.
create view dashboard.source_runs as
  select sr.run_id, sr.firm_id, sr.source, sr.status, sr.companies, sr.new_companies, sr.cap_hit, sr.checkpoint, sr.error, sr.recorded_at
  from portfolio.source_runs sr;

create or replace function public.portfolio_export(p_key text, p_view text, p_offset int default 0, p_limit int default 1000) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare out jsonb;
begin
  if not exists (select 1 from portfolio.ingest_keys k
                 where k.revoked_at is null and 'read' = any (k.kinds) and k.key_hash = extensions.crypt(p_key, k.key_hash)) then
    raise exception 'invalid read key' using errcode = '28000';
  end if;
  if p_view not in ('firms', 'roster', 'companies', 'company_status', 'source_coverage', 'review_queue',
                    'snapshots', 'snapshot_companies', 'firm_penetration', 'portfolio_totals', 'source_runs') then
    raise exception 'unknown view %', p_view;
  end if;
  if p_limit < 1 or p_limit > 5000 or p_offset < 0 then raise exception 'limit must be 1–5000, offset ≥ 0'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(v)), ''[]'') from (select * from dashboard.%I order by 1, 2 offset %s limit %s) v',
                 p_view, p_offset, p_limit) into out;
  return jsonb_build_object('view', p_view, 'offset', p_offset, 'rows', out, 'done', jsonb_array_length(out) < p_limit);
end $$;

revoke execute on all functions in schema portfolio from public;
revoke execute on function public.portfolio_state_h(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.portfolio_state_h(text) from anon, authenticated';
    execute 'grant execute on function public.portfolio_state_h(text) to anon';
    execute 'revoke all on all tables in schema portfolio, dashboard from anon, authenticated';
  end if;
end $$;
grant select on all tables in schema dashboard to dashboard_sync;
