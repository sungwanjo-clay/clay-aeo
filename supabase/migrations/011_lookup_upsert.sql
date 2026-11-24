-- 011: workspace lookups tolerate two firms writing the same company at once.
--
-- Refresh runs firms in parallel groups. Two firms that share a portfolio company both write that company's lookup for
-- the week; with 008's delete-then-insert, the second insert hit the primary key while the first was still uncommitted
-- (duplicate key on workspace_lookups_pkey) and failed that firm. Now the row is upserted: the second writer waits for
-- the first, then updates the row (both carry the same Snowflake lookup, so last write wins). The company's matches are
-- replaced after the row is locked, so they always belong to the write that set the row.
--
-- Same behavior as 008 otherwise: same validation, same review routing, same return value. Run once in the SQL editor.

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

    insert into portfolio.workspace_lookups (snapshot_date, company_id, lookup_status, looked_up_at, first_workspace_at, first_paid_at,
      redemption_status, redeemed_at, note, run_id, paying_arr_usd, churned_arr_usd, churned_at)
    values (d, cid, status, coalesce((r->>'looked_up_at')::timestamptz, now()), (r->>'first_workspace_at')::timestamptz,
      (r->>'first_paid_at')::timestamptz, coalesce(r->>'redemption_status', 'not_connected'), (r->>'redeemed_at')::timestamptz,
      r->>'note', (r->>'run_id')::uuid,
      case when status = 'no_exact_match' then 0 else greatest(0, nullif(r->>'paying_arr_usd', '')::numeric) end,
      case when status = 'no_exact_match' then 0 else greatest(0, nullif(r->>'churned_arr_usd', '')::numeric) end,
      nullif(r->>'churned_at', '')::date)
    on conflict (snapshot_date, company_id) do update set
      lookup_status = excluded.lookup_status, looked_up_at = excluded.looked_up_at,
      first_workspace_at = excluded.first_workspace_at, first_paid_at = excluded.first_paid_at,
      redemption_status = excluded.redemption_status, redeemed_at = excluded.redeemed_at, note = excluded.note,
      run_id = excluded.run_id, paying_arr_usd = excluded.paying_arr_usd, churned_arr_usd = excluded.churned_arr_usd,
      churned_at = excluded.churned_at, recorded_at = now();
    delete from portfolio.workspace_matches where snapshot_date = d and company_id = cid;   -- row is locked: replace its matches
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
