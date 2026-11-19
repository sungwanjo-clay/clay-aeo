-- 006: current paying ARR per company, per firm and per cut, so the Portfolio tab can rank funds by the revenue their
-- portfolios bring.
--
-- Source: DBT.PROD.CUSTOMERS.ARR for workspaces with BINARY_CURRENT_CUSTOMER = 1, summed over each company's DISTINCT
-- matched workspaces (all of them, not only the ≤20 workspace rows Clay sends as match evidence). Clay computes it in
-- the Snowflake status lookup and sends it on the company's workspace_lookups row as paying_arr_usd.
--
-- Rules:
--   * null = not read (lookup failed, or written before this migration); 0 = read, nothing paying now.
--   * A workspace matched to two companies (shared across domains) counts toward both; such companies are already
--     flagged for review by Clay, so this stays rare.
--   * Firm and cut totals sum the companies in that row; a company backed by two firms counts in both firm rows and once
--     in a cut total, like every other count.

alter table portfolio.workspace_lookups add column if not exists paying_arr_usd numeric check (paying_arr_usd is null or paying_arr_usd >= 0);

create or replace function portfolio.ingest_workspace_lookups(rows jsonb) returns jsonb language plpgsql as $$
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
      redemption_status, redeemed_at, note, run_id, paying_arr_usd)
    values (d, cid, status, coalesce((r->>'looked_up_at')::timestamptz, now()), (r->>'first_workspace_at')::timestamptz,
      (r->>'first_paid_at')::timestamptz, coalesce(r->>'redemption_status', 'not_connected'), (r->>'redeemed_at')::timestamptz,
      r->>'note', (r->>'run_id')::uuid,
      case when status = 'no_exact_match' then 0 else greatest(0, nullif(r->>'paying_arr_usd', '')::numeric) end);
    for w in select * from jsonb_array_elements(coalesce(r->'workspaces', '[]')) loop
      insert into portfolio.workspace_matches (snapshot_date, company_id, workspace_id, match_method, matched_value, ever_paid, paying_now)
      values (d, cid, w->>'workspace_id', w->>'match_method', portfolio.norm_domain(w->>'matched_value'),
              (w->>'ever_paid')::boolean, (w->>'paying_now')::boolean)
      on conflict do nothing;
    end loop;
    n := n + 1;
  end loop;
  return jsonb_build_object('lookups_written', n, 'sent_to_review', n_review);
end $$;
revoke execute on function portfolio.ingest_workspace_lookups(jsonb) from public;

-- Views: new columns are appended at the end (CREATE OR REPLACE VIEW keeps existing columns in place).
create or replace view dashboard.snapshot_companies as
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
         case l.lookup_status when 'matched' then true when 'no_exact_match' then false end as has_workspace,
         case when l.lookup_status = 'matched' then ws.workspace_count when l.lookup_status = 'no_exact_match' then 0 end as workspace_count,
         ws.match_methods,
         case when l.lookup_status = 'no_exact_match' then false when l.lookup_status = 'matched' and ws.ever_paid_known > 0 then ws.any_ever_paid end as ever_paid,
         case when l.lookup_status = 'no_exact_match' then false when l.lookup_status = 'matched' and ws.paying_now_known > 0 then ws.any_paying_now end as paying_now,
         l.first_workspace_at, l.first_paid_at,
         coalesce(l.redemption_status, 'not_connected') as redemption_status, l.redeemed_at,
         e.funding_fit, e.net_new_check, fe.first_eligible_at, (fe.first_eligible_at is not null) as eligible_to_date,
         case when l.lookup_status = 'no_exact_match' then 0 when l.lookup_status = 'matched' then l.paying_arr_usd end as paying_arr_usd
  from mem
  left join portfolio.workspace_lookups l on l.snapshot_date = mem.snapshot_date and l.company_id = mem.company_id
  left join ws on ws.snapshot_date = mem.snapshot_date and ws.company_id = mem.company_id
  left join portfolio.company_snapshots e on e.snapshot_date = mem.snapshot_date and e.company_id = mem.company_id
  left join lateral (select min(h.snapshot_date) as first_eligible_at from portfolio.company_snapshots h
                     where h.company_id = mem.company_id and h.snapshot_date <= mem.snapshot_date
                       and h.funding_fit = 'fits' and h.net_new_check = 'pass') fe on true;

create or replace view dashboard.firm_penetration as
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
         bool_or(c.redemption_status <> 'not_connected')                 as redemption_connected,
         coalesce(sum(c.paying_arr_usd), 0)                              as paying_arr_usd,
         count(*) filter (where c.paying_now and c.paying_arr_usd is null) as paying_arr_unknown
  from portfolio.snapshot_membership m
  join dashboard.snapshot_companies c on c.snapshot_date = m.snapshot_date and c.company_id = m.company_id
  group by m.snapshot_date, m.firm_id, m.partnership_cut;

create or replace view dashboard.portfolio_totals as
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
         bool_or(redemption_status <> 'not_connected')              as redemption_connected,
         coalesce(sum(paying_arr_usd), 0)                           as paying_arr_usd,
         count(*) filter (where paying_now and paying_arr_usd is null) as paying_arr_unknown
  from x group by snapshot_date, cut;

grant select on all tables in schema dashboard to dashboard_sync;
