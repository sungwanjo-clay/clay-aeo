-- 009: Salesforce sales tier on the weekly company snapshot, next to total funding.
--
-- Clay's weekly status lookup reads the company's Salesforce account (matched on domain) and now sends
-- total_raised_usd (TOTAL_FUNDING_AMOUNT_C; the column already exists) and sales_tier (SALES_TIER_C) on the
-- snapshot row. Only companies with a Salesforce record get them; everyone else stays null (not zero).

alter table portfolio.company_snapshots add column if not exists sales_tier text;

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
      offer_tier_credits, opportunity_score, score_drivers, data_gaps, run_id, sales_tier)
    values ((r->>'snapshot_date')::date, cid, r->>'funding_stage', (r->>'last_round_at')::date, (r->>'last_round_amount_usd')::numeric,
      (r->>'total_raised_usd')::numeric, (r->>'is_vc_backed')::boolean, (r->>'headcount')::int, (r->>'headcount_growth_6m_pct')::numeric,
      r->>'funding_fit', r->>'funding_fit_reason', r->>'clay_account', r->>'net_new_check', r->>'net_new_reason',
      (r->>'offer_tier_credits')::int, (r->>'opportunity_score')::numeric, r->'score_drivers',
      coalesce(array(select jsonb_array_elements_text(r->'data_gaps')), '{}'), (r->>'run_id')::uuid, nullif(r->>'sales_tier', ''))
    on conflict (snapshot_date, company_id) do update set
      funding_stage = excluded.funding_stage, last_round_at = excluded.last_round_at, last_round_amount_usd = excluded.last_round_amount_usd,
      total_raised_usd = excluded.total_raised_usd, is_vc_backed = excluded.is_vc_backed, headcount = excluded.headcount,
      headcount_growth_6m_pct = excluded.headcount_growth_6m_pct, funding_fit = excluded.funding_fit, funding_fit_reason = excluded.funding_fit_reason,
      clay_account = excluded.clay_account, net_new_check = excluded.net_new_check, net_new_reason = excluded.net_new_reason,
      offer_tier_credits = excluded.offer_tier_credits, opportunity_score = excluded.opportunity_score, score_drivers = excluded.score_drivers,
      data_gaps = excluded.data_gaps, run_id = excluded.run_id, sales_tier = excluded.sales_tier, recorded_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('snapshots_written', n, 'sent_to_review', n_review);
end $$;

-- Appended at the end (CREATE OR REPLACE VIEW keeps existing columns in place).
create or replace view dashboard.company_status as
  select s.company_id, s.snapshot_date, s.funding_stage, s.last_round_at, s.last_round_amount_usd, s.total_raised_usd, s.is_vc_backed,
         s.headcount, s.headcount_growth_6m_pct, s.funding_fit, s.funding_fit_reason, s.clay_account, s.net_new_check, s.net_new_reason,
         s.offer_tier_credits, s.opportunity_score, s.score_drivers, s.data_gaps,
         h.first_funding_fit_at, h.first_eligible_at, s.sales_tier
  from (select distinct on (company_id) * from portfolio.company_snapshots order by company_id, snapshot_date desc) s
  join (select company_id,
               min(snapshot_date) filter (where funding_fit = 'fits') as first_funding_fit_at,
               min(snapshot_date) filter (where funding_fit = 'fits' and net_new_check = 'pass') as first_eligible_at   -- enters the cumulative eligible cohort
        from portfolio.company_snapshots group by company_id) h using (company_id);

grant select on all tables in schema dashboard to dashboard_sync;
