-- 002: dated reporting snapshots, Clay's workspace lookups, and the reporting views.
-- Applies on top of 001_portfolio.sql. Not applied anywhere yet; tested with supabase/test/002_test.sql.
--
-- Ownership: Clay does the Snowflake lookup and writes results here; Supabase owns the reporting math
-- (dashboard.* views); the Portfolio tab only displays those views, as of the last COMPLETE snapshot.
--
-- A snapshot (one per snapshot_date) has three steps, all through public.portfolio_ingest:
--   1. snapshot_open      [{snapshot_date, run_id?}]           opens the week (or no-op if already open)
--   2. workspace_lookups  one row per company: lookup_status + the workspaces Clay matched in Snowflake
--      snapshots          (from 001) the weekly eligibility rows, same snapshot_date
--   3. snapshot_close     [{snapshot_date}]                     freezes portfolio membership and marks it complete
-- Retrying any step is safe. A complete snapshot can't be written to; reopen it explicitly
-- ([{snapshot_date, reopen: true}] on snapshot_open) to redo a week, which refreezes membership on the next close.
--
-- Rules carried into the views:
--   * Membership is frozen at close, so roster changes after a week closes don't change that week's rates.
--   * lookup_status is matched / no_exact_match / needs_review / failed. Only matched counts as having a
--     workspace and only no_exact_match counts as not having one; needs_review, failed and missing are unknown.
--   * Workspace ids are deduplicated across match methods. Match evidence stays in portfolio; the
--     dashboard sees company-level counts only.
--   * ever_paid and paying_now are separate. first_workspace_at, first_paid_at and redemption stay blank
--     until their source fields are verified; redemption_status defaults to 'not_connected', and a blank
--     redeemed_at is never read as "did not redeem".

-- ───────────────────────── Snapshots ─────────────────────────
create table portfolio.snapshots (
  snapshot_date  date primary key,
  status         text not null default 'open' check (status in ('open', 'complete')),
  run_id         uuid,
  opened_at      timestamptz not null default now(),
  completed_at   timestamptz,
  reopened_count int not null default 0
);

-- Portfolio membership as of the close: one row per verified, qualifying company × firm link.
create table portfolio.snapshot_membership (
  snapshot_date      date not null references portfolio.snapshots on delete cascade,
  relationship_id    uuid not null,
  company_id         uuid not null,
  firm_id            uuid not null,
  qualifying_sources text[] not null,
  shared_by_partner  boolean not null,
  partnership_cut    text not null,        -- the firm's cut at close: partnered / pending / not_partnered
  primary key (snapshot_date, relationship_id)
);
create index on portfolio.snapshot_membership (snapshot_date, company_id);

-- ───────────────────────── Clay's Snowflake lookup ─────────────────────────
create table portfolio.workspace_lookups (
  snapshot_date      date not null references portfolio.snapshots on delete cascade,
  company_id         uuid not null references portfolio.companies on delete cascade,
  lookup_status      text not null check (lookup_status in ('matched', 'no_exact_match', 'needs_review', 'failed')),
  looked_up_at       timestamptz not null,
  first_workspace_at timestamptz,          -- blank until the source field is verified
  first_paid_at      timestamptz,          -- blank until the source field is verified
  redemption_status  text not null default 'not_connected' check (redemption_status in ('not_connected', 'redeemed', 'not_redeemed')),
  redeemed_at        timestamptz,          -- blank until redemptions are connected; never means "did not redeem"
  note               text,
  run_id             uuid,
  recorded_at        timestamptz not null default now(),
  primary key (snapshot_date, company_id),
  check (redemption_status <> 'not_connected' or redeemed_at is null)
);

-- Every workspace Clay matched, per method. Internal evidence; not exposed to the dashboard.
create table portfolio.workspace_matches (
  snapshot_date  date not null,
  company_id     uuid not null,
  workspace_id   text not null,
  match_method   text not null check (match_method in ('creator_domain', 'attribution_domain', 'customers_domain', 'manual')),
  matched_value  text,                     -- e.g. the domain that matched
  ever_paid      boolean,                  -- per workspace, as Clay read it; null = not read
  paying_now     boolean,
  primary key (snapshot_date, company_id, workspace_id, match_method),
  foreign key (snapshot_date, company_id) references portfolio.workspace_lookups on delete cascade
);

alter table portfolio.snapshots enable row level security;
alter table portfolio.snapshot_membership enable row level security;
alter table portfolio.workspace_lookups enable row level security;
alter table portfolio.workspace_matches enable row level security;

-- clay_account / matched_workspace_ids on company_snapshots (001) are superseded by workspace_lookups;
-- the views below don't read them. Kept so existing writers don't break.
comment on column portfolio.company_snapshots.clay_account is 'Superseded by portfolio.workspace_lookups (002); not used by dashboard views.';

alter table portfolio.workflow_runs drop constraint workflow_runs_workflow_check;
alter table portfolio.workflow_runs add constraint workflow_runs_workflow_check
  check (workflow in ('firms', 'roster', 'snapshot', 'workspace_lookup'));

-- ───────────────────────── Partnership cut (agreed rule) ─────────────────────────
-- To Approve overrides the Partner checkbox; Proven is a separate flag and does not make a firm partnered.
create function portfolio.partnership_cut(f portfolio.firms) returns text language sql immutable as $$
  select case when f.on_to_approve_tab then 'pending' when coalesce(f.partner_checkbox, false) then 'partnered' else 'not_partnered' end
$$;

-- ═════════════════════════ Ingest ═════════════════════════
create function portfolio.snapshot_status(d date) returns text language sql stable as $$
  select status from portfolio.snapshots where snapshot_date = d
$$;

create function portfolio.ingest_snapshot_open(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; d date; st text; out jsonb := '[]';
begin
  for r in select * from jsonb_array_elements(rows) loop
    d := (r->>'snapshot_date')::date;
    if d is null then raise exception 'snapshot_open needs snapshot_date'; end if;
    st := portfolio.snapshot_status(d);
    if st is null then
      insert into portfolio.snapshots (snapshot_date, run_id) values (d, (r->>'run_id')::uuid);
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'opened');
    elsif st = 'complete' and coalesce((r->>'reopen')::boolean, false) then
      update portfolio.snapshots set status = 'open', completed_at = null, reopened_count = reopened_count + 1,
        run_id = coalesce((r->>'run_id')::uuid, run_id) where snapshot_date = d;
      delete from portfolio.snapshot_membership where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'reopened');
    else
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'already_' || st);
    end if;
  end loop;
  return jsonb_build_object('snapshots', out);
end $$;

create function portfolio.ingest_snapshot_close(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; d date; st text; n int; out jsonb := '[]';
begin
  for r in select * from jsonb_array_elements(rows) loop
    d := (r->>'snapshot_date')::date;
    st := portfolio.snapshot_status(d);
    if st is null then
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'not_open');
    elsif st = 'complete' then
      select count(*) into n from portfolio.snapshot_membership where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'already_complete', 'members', n);
    else
      -- Freeze: verified links with qualifying evidence first seen on or before the snapshot date. Using the date
      -- (not "now") means reopening an old week reproduces that week's roster instead of today's.
      insert into portfolio.snapshot_membership (snapshot_date, relationship_id, company_id, firm_id, qualifying_sources, shared_by_partner, partnership_cut)
      select d, cf.relationship_id, cf.company_id, cf.firm_id,
             array_agg(distinct e.source order by e.source), bool_or(e.source = 'partner_list'), portfolio.partnership_cut(f)
      from portfolio.company_firms cf
      join portfolio.firms f using (firm_id)
      join portfolio.relationship_evidence e using (relationship_id)
      join portfolio.sources s on s.source = e.source and s.counts_toward_denominator
      where cf.verification_status = 'verified' and e.first_observed_at < d + 1
      group by cf.relationship_id, cf.company_id, cf.firm_id, f.firm_id;
      get diagnostics n = row_count;
      update portfolio.snapshots set status = 'complete', completed_at = now() where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'completed', 'members', n);
    end if;
  end loop;
  return jsonb_build_object('snapshots', out);
end $$;

-- One row per company: {snapshot_date, <company identifiers>, lookup_status, looked_up_at?,
--   workspaces: [{workspace_id, match_method, matched_value?, ever_paid?, paying_now?}],
--   first_workspace_at?, first_paid_at?, redemption_status?, redeemed_at?, note?, run_id?}
-- A retry replaces that company's lookup for that week (no duplicates); other weeks are untouched.
create function portfolio.ingest_workspace_lookups(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; d date; st text; cid uuid; status text; nws int; n int := 0; n_review int := 0; w jsonb;
begin
  for r in select * from jsonb_array_elements(rows) loop
    d := (r->>'snapshot_date')::date;
    st := portfolio.snapshot_status(d);
    if st is distinct from 'open' then
      insert into portfolio.match_review (kind, reason, row_data) values ('workspace_lookup', case when st is null then 'snapshot_not_open' else 'snapshot_complete' end, r);
      n_review := n_review + 1; continue;
    end if;
    status := r->>'lookup_status';
    nws := coalesce(jsonb_array_length(case when jsonb_typeof(r->'workspaces') = 'array' then r->'workspaces' end), 0);
    if status is null or status not in ('matched', 'no_exact_match', 'needs_review', 'failed')
       or (status = 'matched' and nws = 0) or (status = 'no_exact_match' and nws > 0) then
      insert into portfolio.match_review (kind, reason, row_data) values ('workspace_lookup', 'inconsistent_lookup_status', r);
      n_review := n_review + 1; continue;
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(r->'workspaces', '[]')) x
               where nullif(x->>'workspace_id', '') is null
                  or coalesce(x->>'match_method', '') not in ('creator_domain', 'attribution_domain', 'customers_domain', 'manual')) then
      insert into portfolio.match_review (kind, reason, row_data) values ('workspace_lookup', 'bad_workspace_row', r);
      n_review := n_review + 1; continue;
    end if;
    cid := portfolio.resolve_company(r, false, 'workspace_lookup');
    if cid is null then n_review := n_review + 1; continue; end if;

    delete from portfolio.workspace_lookups where snapshot_date = d and company_id = cid;   -- cascades to its matches
    insert into portfolio.workspace_lookups (snapshot_date, company_id, lookup_status, looked_up_at, first_workspace_at, first_paid_at,
      redemption_status, redeemed_at, note, run_id)
    values (d, cid, status, coalesce((r->>'looked_up_at')::timestamptz, now()), (r->>'first_workspace_at')::timestamptz,
      (r->>'first_paid_at')::timestamptz, coalesce(r->>'redemption_status', 'not_connected'), (r->>'redeemed_at')::timestamptz,
      r->>'note', (r->>'run_id')::uuid);
    for w in select * from jsonb_array_elements(coalesce(r->'workspaces', '[]')) loop
      insert into portfolio.workspace_matches (snapshot_date, company_id, workspace_id, match_method, matched_value, ever_paid, paying_now)
      values (d, cid, w->>'workspace_id', w->>'match_method', portfolio.norm_domain(w->>'matched_value'),
              (w->>'ever_paid')::boolean, (w->>'paying_now')::boolean)
      on conflict do nothing;   -- the same workspace + method twice in one row is one match
    end loop;
    n := n + 1;
  end loop;
  return jsonb_build_object('lookups_written', n, 'sent_to_review', n_review);
end $$;

-- Eligibility rows (001) now also belong to a snapshot and can't change once it's complete.
create or replace function portfolio.ingest_snapshots(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; cid uuid; st text; n int := 0; n_review int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    st := portfolio.snapshot_status((r->>'snapshot_date')::date);
    if st is distinct from 'open' then
      insert into portfolio.match_review (kind, reason, row_data) values ('snapshot', case when st is null then 'snapshot_not_open' else 'snapshot_complete' end, r);
      n_review := n_review + 1; continue;
    end if;
    cid := portfolio.resolve_company(r, false, 'snapshot');
    if cid is null then n_review := n_review + 1; continue; end if;
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
    when 'workspace_lookups' then portfolio.ingest_workspace_lookups(p_rows)
    else null end;
end $$;

-- The Clay key gets the new kinds.
update portfolio.ingest_keys set kinds = array(select distinct unnest(kinds || '{snapshot_open,snapshot_close,workspace_lookups}'::text[]))
where key_name = 'clay-workflows';

-- ═════════════════════════ Reporting views ═════════════════════════
create or replace view dashboard.firms as
  select f.firm_id, f.name, f.firm_type, f.partner_checkbox, f.on_proven_tab, f.on_to_approve_tab,
         f.stage_focus, f.is_multi_stage, f.sector_focus, f.region, f.outreached, f.referral_utm_campaign, f.referral_utm_medium,
         (select max(finished_at) from portfolio.workflow_runs w where w.firm_id = f.firm_id and w.workflow = 'roster' and w.status = 'succeeded') as roster_refreshed_at,
         portfolio.partnership_cut(f) as partnership_cut
  from portfolio.firms f;

create view dashboard.snapshots as
  select s.snapshot_date, s.status, s.completed_at, s.reopened_count,
         (select count(*) from portfolio.snapshot_membership m where m.snapshot_date = s.snapshot_date) as member_links,
         (select count(distinct company_id) from portfolio.snapshot_membership m where m.snapshot_date = s.snapshot_date) as member_companies,
         (select count(*) from portfolio.workspace_lookups l where l.snapshot_date = s.snapshot_date) as lookups,
         s.snapshot_date = (select max(snapshot_date) from portfolio.snapshots where status = 'complete') as is_latest_complete
  from portfolio.snapshots s;

-- Company-level status per snapshot (members only). No workspace ids; counts only.
create view dashboard.snapshot_companies as
  with mem as (
    select m.snapshot_date, m.company_id, array_agg(distinct m.firm_id) as firm_ids,
           array_agg(distinct m.partnership_cut) as cuts, bool_or(m.shared_by_partner) as shared_by_partner
    from portfolio.snapshot_membership m group by m.snapshot_date, m.company_id
  ), ws as (
    select snapshot_date, company_id, count(distinct workspace_id) as workspace_count,
           array_agg(distinct match_method order by match_method) as match_methods,
           bool_or(ever_paid) as any_ever_paid, bool_or(paying_now) as any_paying_now,
           count(ever_paid) as ever_paid_known, count(paying_now) as paying_now_known
    from portfolio.workspace_matches group by snapshot_date, company_id
  )
  select mem.snapshot_date, mem.company_id, mem.firm_ids, mem.cuts, mem.shared_by_partner,
         coalesce(l.lookup_status, 'missing') as lookup_status,
         case l.lookup_status when 'matched' then true when 'no_exact_match' then false end as has_workspace,   -- null = unknown
         case when l.lookup_status = 'matched' then ws.workspace_count when l.lookup_status = 'no_exact_match' then 0 end as workspace_count,
         ws.match_methods,
         case when l.lookup_status = 'no_exact_match' then false when l.lookup_status = 'matched' and ws.ever_paid_known > 0 then ws.any_ever_paid end as ever_paid,
         case when l.lookup_status = 'no_exact_match' then false when l.lookup_status = 'matched' and ws.paying_now_known > 0 then ws.any_paying_now end as paying_now,
         l.first_workspace_at, l.first_paid_at,
         coalesce(l.redemption_status, 'not_connected') as redemption_status, l.redeemed_at,
         e.funding_fit, e.net_new_check, fe.first_eligible_at, (fe.first_eligible_at is not null) as eligible_to_date
  from mem
  left join portfolio.workspace_lookups l on l.snapshot_date = mem.snapshot_date and l.company_id = mem.company_id
  left join ws on ws.snapshot_date = mem.snapshot_date and ws.company_id = mem.company_id
  left join portfolio.company_snapshots e on e.snapshot_date = mem.snapshot_date and e.company_id = mem.company_id
  -- Cumulative: first week the company was confirmed eligible, on or before this snapshot.
  left join lateral (select min(h.snapshot_date) as first_eligible_at from portfolio.company_snapshots h
                     where h.company_id = mem.company_id and h.snapshot_date <= mem.snapshot_date
                       and h.funding_fit = 'fits' and h.net_new_check = 'pass') fe on true;

-- Per snapshot × firm. Rates are left to the page, which shows numerator and denominator side by side.
create view dashboard.firm_penetration as
  select m.snapshot_date, m.firm_id, m.partnership_cut,
         count(*)                                                        as portfolio,
         count(*) filter (where m.shared_by_partner)                     as shared_by_partner,
         count(*) filter (where c.has_workspace)                         as with_workspace,
         count(*) filter (where c.lookup_status = 'no_exact_match')      as no_exact_match,
         count(*) filter (where c.lookup_status in ('needs_review', 'failed', 'missing')) as workspace_unknown,
         count(*) filter (where c.ever_paid)                             as ever_paid,
         count(*) filter (where c.paying_now)                            as paying_now,
         count(*) filter (where c.has_workspace and c.paying_now is null) as paying_unknown,
         count(*) filter (where c.eligible_to_date)                      as eligible_to_date,
         count(*) filter (where c.eligible_to_date and c.redemption_status = 'redeemed') as redeemed,
         bool_or(c.redemption_status <> 'not_connected')                 as redemption_connected
  from portfolio.snapshot_membership m
  join dashboard.snapshot_companies c on c.snapshot_date = m.snapshot_date and c.company_id = m.company_id
  group by m.snapshot_date, m.firm_id, m.partnership_cut;

-- Per snapshot × cut ('all' plus each cut). A company counts once per cut even if several firms back it.
create view dashboard.portfolio_totals as
  with x as (
    select c.*, cut from dashboard.snapshot_companies c, unnest(c.cuts || '{all}'::text[]) cut
  )
  select snapshot_date, cut,
         count(*)                                                   as portfolio,
         count(*) filter (where has_workspace)                      as with_workspace,
         count(*) filter (where lookup_status = 'no_exact_match')   as no_exact_match,
         count(*) filter (where lookup_status in ('needs_review', 'failed', 'missing')) as workspace_unknown,
         count(*) filter (where ever_paid)                          as ever_paid,
         count(*) filter (where paying_now)                         as paying_now,
         count(*) filter (where has_workspace and paying_now is null) as paying_unknown,
         count(*) filter (where eligible_to_date)                   as eligible_to_date,
         count(*) filter (where eligible_to_date and redemption_status = 'redeemed') as redeemed,
         bool_or(redemption_status <> 'not_connected')              as redemption_connected
  from x group by snapshot_date, cut;

create or replace function public.portfolio_export(p_key text, p_view text, p_offset int default 0, p_limit int default 1000) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare out jsonb;
begin
  if not exists (select 1 from portfolio.ingest_keys k
                 where k.revoked_at is null and 'read' = any (k.kinds) and k.key_hash = extensions.crypt(p_key, k.key_hash)) then
    raise exception 'invalid read key' using errcode = '28000';
  end if;
  if p_view not in ('firms', 'roster', 'companies', 'company_status', 'source_coverage', 'review_queue',
                    'snapshots', 'snapshot_companies', 'firm_penetration', 'portfolio_totals') then
    raise exception 'unknown view %', p_view;
  end if;
  if p_limit < 1 or p_limit > 5000 or p_offset < 0 then raise exception 'limit must be 1–5000, offset ≥ 0'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(v)), ''[]'') from (select * from dashboard.%I order by 1, 2 offset %s limit %s) v',
                 p_view, p_offset, p_limit) into out;
  return jsonb_build_object('view', p_view, 'offset', p_offset, 'rows', out, 'done', jsonb_array_length(out) < p_limit);
end $$;

-- Grants: same boundaries as 001.
revoke execute on all functions in schema portfolio from public;
grant select on all tables in schema dashboard to dashboard_sync;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema portfolio, dashboard from anon, authenticated';
  end if;
end $$;
