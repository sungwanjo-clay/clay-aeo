-- 010: the weekly firm-list sync from the Venture Partner Program sheet (All Priority + To Approve + Proven tabs).
--
-- A firm that leaves the sheet is REMOVED, not deleted: removed_at is set, its history stays, and weeks closed after
-- the removal leave it out (membership requires the firm to be listed at the end of the week). A firm that comes back
-- is listed again. New firms are created as before (ingest_firms) and returned so the routine can run their baseline
-- discovery.
--
-- portfolio.ingest_firm_list takes the FULL list in one call. It refuses (and changes nothing) when the list would
-- remove more than 20% of the listed firms at once, which is what a truncated or wrong sheet read looks like; a real
-- clean-up that large is done by hand.
--
-- After applying, copy the key the last statement prints into the routine's environment as PORTFOLIO_SHEET_KEY.
-- It can only write kind 'firm_list'. (Run this file once; running it again rotates the key.)

alter table portfolio.firms add column if not exists removed_at timestamptz;
alter table portfolio.firms add column if not exists listed_at timestamptz;

create or replace function portfolio.ingest_firm_list(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; fid uuid; listed uuid[] := '{}'; new_ids uuid[] := '{}'; before_ids uuid[]; up jsonb;
        n_active int; n_remove int; removed jsonb; back jsonb;
begin
  select coalesce(array_agg(firm_id), '{}') into before_ids from portfolio.firms;
  select count(*) into n_active from portfolio.firms where removed_at is null;
  up := portfolio.ingest_firms(rows);                        -- creates new firms, updates the sheet fields
  for r in select * from jsonb_array_elements(rows) loop
    fid := portfolio.resolve_firm(r);
    if fid is not null then listed := listed || fid; end if;
  end loop;
  select count(*) into n_remove from portfolio.firms where removed_at is null and not (firm_id = any (listed));
  if n_active > 0 and n_remove > greatest(5, n_active / 5) then
    raise exception 'firm list would remove % of % listed firms; refusing (truncated sheet read?)', n_remove, n_active using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('firm_id', firm_id, 'name', name)), '[]') into removed
    from portfolio.firms where removed_at is null and not (firm_id = any (listed));
  update portfolio.firms set removed_at = now(), updated_at = now() where removed_at is null and not (firm_id = any (listed));
  select coalesce(jsonb_agg(jsonb_build_object('firm_id', firm_id, 'name', name)), '[]') into back
    from portfolio.firms where removed_at is not null and firm_id = any (listed);
  update portfolio.firms set removed_at = null, updated_at = now() where removed_at is not null and firm_id = any (listed);
  update portfolio.firms set listed_at = now() where firm_id = any (listed);
  select coalesce(array_agg(x), '{}') into new_ids from unnest(listed) x where not (x = any (before_ids));
  return jsonb_build_object(
    'listed', cardinality(listed), 'firms_new', up->'firms_new', 'firms_updated', up->'firms_updated',
    'new', (select coalesce(jsonb_agg(jsonb_build_object('firm_id', f.firm_id, 'name', f.name)), '[]') from portfolio.firms f where f.firm_id = any (new_ids)),
    'removed', removed, 'reactivated', back);
end $$;
revoke execute on function portfolio.ingest_firm_list(jsonb) from public;

-- Weeks closed after a firm's removal leave it out; reopening an older week still reproduces that week.
create or replace function portfolio.ingest_snapshot_close(rows jsonb) returns jsonb language plpgsql as $$
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
      insert into portfolio.snapshot_membership (snapshot_date, relationship_id, company_id, firm_id, qualifying_sources, shared_by_partner, partnership_cut)
      select d, cf.relationship_id, cf.company_id, cf.firm_id,
             array_agg(distinct e.source order by e.source), bool_or(e.source = 'partner_list'), portfolio.partnership_cut(f)
      from portfolio.company_firms cf
      join portfolio.firms f using (firm_id)
      join portfolio.relationship_evidence e using (relationship_id)
      join portfolio.sources s on s.source = e.source and s.counts_toward_denominator
      where cf.verification_status = 'verified' and e.first_observed_at < d + 7
        and (f.removed_at is null or f.removed_at >= d + 7)
      group by cf.relationship_id, cf.company_id, cf.firm_id, f.firm_id;
      get diagnostics n = row_count;
      update portfolio.snapshots set status = 'complete', completed_at = now() where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'completed', 'members', n);
    end if;
  end loop;
  return jsonb_build_object('snapshots', out);
end $$;
revoke execute on function portfolio.ingest_snapshot_close(jsonb) from public;

-- The firm list the dashboard shows: listed firms only (removed ones keep their history in closed weeks).
create or replace view dashboard.firms as
  select f.firm_id, f.name, f.firm_type, f.partner_checkbox, f.on_proven_tab, f.on_to_approve_tab,
         f.stage_focus, f.is_multi_stage, f.sector_focus, f.region, f.outreached, f.referral_utm_campaign, f.referral_utm_medium,
         (select max(finished_at) from portfolio.workflow_runs w where w.firm_id = f.firm_id and w.workflow = 'roster' and w.status = 'succeeded') as roster_refreshed_at,
         portfolio.partnership_cut(f) as partnership_cut,
         f.removed_at
  from portfolio.firms f
  where f.removed_at is null;

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
    when 'firm_list'         then portfolio.ingest_firm_list(p_rows)
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

-- The sheet-sync key: firm_list only. The plaintext is shown once, by the last statement.
create temp table _sheet_key as select encode(extensions.gen_random_bytes(24), 'hex') as key;
insert into portfolio.ingest_keys (key_name, key_hash, kinds)
  select 'sheet-sync', extensions.crypt(key, extensions.gen_salt('bf')), '{firm_list}' from _sheet_key
on conflict (key_name) do update set key_hash = excluded.key_hash, kinds = excluded.kinds, revoked_at = null;
select key as portfolio_sheet_key from _sheet_key;
