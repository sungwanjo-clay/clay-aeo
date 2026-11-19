-- 008: churned companies and their ARR at churn, next to current paying ARR, so the Portfolio tab can rank
-- re-engagement: which portfolio companies (and which funds' portfolios) used to pay and stopped.
--
-- Source: DBT.PROD.CUSTOMERS. For a workspace that ever paid and is not a current customer, ARR is 0 there, so Clay
-- annualizes its last invoice (LATEST_INVOICE_AMOUNT x 12 monthly, x 4 quarterly, x 2 bi-annually, x 1 yearly); on
-- current customers that estimate is within 20% of ARR for 98% of workspaces and within 4% in total. churned_at is the
-- latest subscription cancellation (else latest invoice) over those workspaces.
--
-- Rules:
--   * A company is churned when it ever paid and has no paying workspace now (the same ever_paid / paying_now as the
--     other columns). A company still paying elsewhere is not churned, and its churned_arr_usd is 0.
--   * null = not read (lookup failed, or written before this migration).
--   * Totals add up like paying ARR: once per company in a cut, once per firm row for each backing firm.

alter table portfolio.workspace_lookups add column if not exists churned_arr_usd numeric check (churned_arr_usd is null or churned_arr_usd >= 0);
alter table portfolio.workspace_lookups add column if not exists churned_at date;

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
      redemption_status, redeemed_at, note, run_id, paying_arr_usd, churned_arr_usd, churned_at)
    values (d, cid, status, coalesce((r->>'looked_up_at')::timestamptz, now()), (r->>'first_workspace_at')::timestamptz,
      (r->>'first_paid_at')::timestamptz, coalesce(r->>'redemption_status', 'not_connected'), (r->>'redeemed_at')::timestamptz,
      r->>'note', (r->>'run_id')::uuid,
      case when status = 'no_exact_match' then 0 else greatest(0, nullif(r->>'paying_arr_usd', '')::numeric) end,
      case when status = 'no_exact_match' then 0 else greatest(0, nullif(r->>'churned_arr_usd', '')::numeric) end,
      nullif(r->>'churned_at', '')::date);
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
         case when l.lookup_status = 'no_exact_match' then 0 when l.lookup_status = 'matched' then l.paying_arr_usd end as paying_arr_usd,
         -- Churned = paid before, nothing paying now. Its ARR is what it paid on its last invoice, annualized.
         case when l.lookup_status = 'no_exact_match' then 0
              when l.lookup_status = 'matched' and ws.paying_now_known > 0 and ws.ever_paid_known > 0 and ws.any_ever_paid and not ws.any_paying_now then l.churned_arr_usd
              when l.lookup_status = 'matched' and ws.paying_now_known > 0 then 0 end as churned_arr_usd,
         case when l.lookup_status = 'matched' and ws.any_ever_paid and not ws.any_paying_now then l.churned_at end as churned_at
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
         count(*) filter (where c.paying_now and c.paying_arr_usd is null) as paying_arr_unknown,
         count(*) filter (where c.ever_paid and not c.paying_now)          as churned,
         coalesce(sum(c.churned_arr_usd), 0)                             as churned_arr_usd,
         count(*) filter (where c.ever_paid and not c.paying_now and c.churned_at >= m.snapshot_date - 90) as churned_90d
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
         count(*) filter (where paying_now and paying_arr_usd is null) as paying_arr_unknown,
         count(*) filter (where ever_paid and not paying_now)      as churned,
         coalesce(sum(churned_arr_usd), 0)                         as churned_arr_usd,
         count(*) filter (where ever_paid and not paying_now and churned_at >= snapshot_date - 90) as churned_90d
  from x group by snapshot_date, cut;

grant select on all tables in schema dashboard to dashboard_sync;
