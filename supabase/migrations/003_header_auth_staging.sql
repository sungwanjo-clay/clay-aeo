-- 003: header-authenticated ingest for Clay, and staging snapshots. Applies on top of 002.
--
-- Clay's HTTP API connections keep secrets in headers, so Clay calls
--   POST /rest/v1/rpc/portfolio_ingest_h      body: {"p_kind": "...", "p_rows": [...]}
--   headers: apikey: <publishable key>, x-portfolio-key: <writer key>
-- The function reads x-portfolio-key from the request headers PostgREST passes in and runs the exact same
-- key check and kind restrictions as public.portfolio_ingest. The key never appears in the request body.
--
-- Staging: snapshot_open with {"snapshot_date": ..., "staging": true} creates a staging week. It behaves like any
-- week (lookups, freeze on close, retries) but never becomes the dashboard's latest week, and it can be removed
-- with snapshot_discard. Production weeks can't be discarded.

alter table portfolio.snapshots add column is_staging boolean not null default false;

-- Staging and production weeks can't share a date (a staging run on a production date would be ambiguous).
create or replace function portfolio.ingest_snapshot_open(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; d date; st text; stg boolean; cur_stg boolean; out jsonb := '[]';
begin
  for r in select * from jsonb_array_elements(rows) loop
    d := (r->>'snapshot_date')::date;
    if d is null then raise exception 'snapshot_open needs snapshot_date'; end if;
    stg := coalesce((r->>'staging')::boolean, false);
    select status, is_staging into st, cur_stg from portfolio.snapshots where snapshot_date = d;
    if st is null then
      insert into portfolio.snapshots (snapshot_date, run_id, is_staging) values (d, (r->>'run_id')::uuid, stg);
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'opened', 'staging', stg);
    elsif cur_stg <> stg then
      out := out || jsonb_build_object('snapshot_date', d, 'result', case when cur_stg then 'date_is_staging' else 'date_is_production' end);
    elsif st = 'complete' and coalesce((r->>'reopen')::boolean, false) then
      update portfolio.snapshots set status = 'open', completed_at = null, reopened_count = reopened_count + 1,
        run_id = coalesce((r->>'run_id')::uuid, run_id) where snapshot_date = d;
      delete from portfolio.snapshot_membership where snapshot_date = d;
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'reopened', 'staging', stg);
    else
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'already_' || st, 'staging', stg);
    end if;
  end loop;
  return jsonb_build_object('snapshots', out);
end $$;

-- Removes a staging week and everything written to it. Refuses production weeks.
create function portfolio.ingest_snapshot_discard(rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; d date; stg boolean; out jsonb := '[]';
begin
  for r in select * from jsonb_array_elements(rows) loop
    d := (r->>'snapshot_date')::date;
    select is_staging into stg from portfolio.snapshots where snapshot_date = d;
    if stg is null then
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'not_found');
    elsif not stg then
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'refused_production');
    else
      delete from portfolio.company_snapshots where snapshot_date = d;
      delete from portfolio.snapshots where snapshot_date = d;   -- cascades to membership, lookups, matches
      out := out || jsonb_build_object('snapshot_date', d, 'result', 'discarded');
    end if;
  end loop;
  return jsonb_build_object('snapshots', out);
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
    else null end;
end $$;

-- Header-authenticated entry point for Clay.
create function public.portfolio_ingest_h(p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare k text := nullif(current_setting('request.headers', true), '')::json->>'x-portfolio-key';
begin
  if k is null then raise exception 'missing x-portfolio-key header' using errcode = '28000'; end if;
  return public.portfolio_ingest(k, p_kind, p_rows);
end $$;

update portfolio.ingest_keys set kinds = array(select distinct unnest(kinds || '{snapshot_discard}'::text[]))
where key_name = 'clay-workflows';

-- The dashboard's latest week ignores staging.
create or replace view dashboard.snapshots as
  select s.snapshot_date, s.status, s.completed_at, s.reopened_count,
         (select count(*) from portfolio.snapshot_membership m where m.snapshot_date = s.snapshot_date) as member_links,
         (select count(distinct company_id) from portfolio.snapshot_membership m where m.snapshot_date = s.snapshot_date) as member_companies,
         (select count(*) from portfolio.workspace_lookups l where l.snapshot_date = s.snapshot_date) as lookups,
         s.snapshot_date = (select max(snapshot_date) from portfolio.snapshots where status = 'complete' and not is_staging) as is_latest_complete,
         s.is_staging
  from portfolio.snapshots s;

revoke execute on all functions in schema portfolio from public;
revoke execute on function public.portfolio_ingest_h(text, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.portfolio_ingest_h(text, jsonb) from anon, authenticated';
    execute 'grant execute on function public.portfolio_ingest_h(text, jsonb) to anon';
  end if;
end $$;
grant select on all tables in schema dashboard to dashboard_sync;
