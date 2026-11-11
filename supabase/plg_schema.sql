-- ════════════════════════════════════════════════════════════════════════════
-- PLG Weekly Metrics dashboard — storage + read RPCs
--
-- Data flow:
--   Snowflake (dbt.prod.fct_plg_workspace_blended_attribution + customers +
--   SFDC account tier)  ──nightly /api/plg/refresh──▶  plg_daily_facts
--   Dashboard (/plg) ──/api/plg/dashboard──▶ plg_range_summary / plg_daily_series
--
-- Every table has RLS on and NO policies: only the service role (server-side)
-- can read or write. The RPCs are granted to service_role only, so PLG numbers
-- are never reachable with the public anon key.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Facts ───────────────────────────────────────────────────────────────────

create table if not exists plg_daily_facts (
  day              date    not null,
  channel_category text    not null,
  channel          text    not null,
  subchannel       text    not null,
  sales_tier       text    not null,   -- 'Tier 1'..'Tier 4' | 'Unassigned'
  quality_segment  text    not null,   -- personal | non-personal: high quality | non-personal: low quality | spam | not available
  n                integer not null,
  primary key (day, channel_category, channel, subchannel, sales_tier, quality_segment)
);
create index if not exists plg_daily_facts_day_idx on plg_daily_facts (day);

-- CUSTOMERS.CUSTOMER_DOMAIN_SEGMENT check (independent of quality scoring)
create table if not exists plg_daily_domain_segment (
  day     date    not null,
  segment text    not null,                -- personal | academic | non_personal | unknown
  n       integer not null,
  primary key (day, segment)
);

-- Canonical metrics-table total vs our workspace-level total, per day
create table if not exists plg_daily_reconciliation (
  day           date primary key,
  facts_total   integer not null,
  metrics_total integer,
  checked_at    timestamptz not null default now()
);

-- ── Guardrail logs ──────────────────────────────────────────────────────────

create table if not exists plg_restatement_log (
  id          bigserial primary key,
  week_start  date        not null,
  old_total   integer     not null,
  new_total   integer     not null,
  detected_at timestamptz not null default now()
);
create index if not exists plg_restatement_log_detected_idx on plg_restatement_log (detected_at desc);

create table if not exists plg_etl_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',   -- running | ok | error
  window_start date,
  window_end   date,
  fact_rows    integer,
  message      text
);

-- ── Goals (configurable without a deploy) ───────────────────────────────────
-- One row per (quarter, scope, key):
--   scope 'quarter', key 'total'          → value = whole-quarter goal
--   scope 'tier',    key 'Tier 1'..'Tier 4' → value = weekly goal
--   scope 'group',   key 'oauth'|'organic'|'paid' → value = weekly goal
-- Rows here override the defaults in lib/plg/config.ts. To add Q1 2027, insert
-- rows with the new quarter_start/quarter_end; nothing else changes.

create table if not exists plg_goals (
  quarter_label text    not null,
  quarter_start date    not null,
  quarter_end   date    not null,
  scope         text    not null check (scope in ('quarter', 'tier', 'group')),
  key           text    not null,
  value         numeric not null,
  updated_at    timestamptz not null default now(),
  primary key (quarter_start, scope, key)
);

insert into plg_goals (quarter_label, quarter_start, quarter_end, scope, key, value) values
  ('Q4', '2026-11-01', '2027-01-31', 'quarter', 'total',   150000),
  ('Q4', '2026-11-01', '2027-01-31', 'tier',    'Tier 1',     400),
  ('Q4', '2026-11-01', '2027-01-31', 'tier',    'Tier 2',    1000),
  ('Q4', '2026-11-01', '2027-01-31', 'tier',    'Tier 3',    2600),
  ('Q4', '2026-11-01', '2027-01-31', 'tier',    'Tier 4',    7538),
  ('Q4', '2026-11-01', '2027-01-31', 'group',   'oauth',     3000),
  ('Q4', '2026-11-01', '2027-01-31', 'group',   'organic',   6000),
  ('Q4', '2026-11-01', '2027-01-31', 'group',   'paid',       400)
on conflict do nothing;

alter table plg_daily_facts          enable row level security;
alter table plg_daily_domain_segment enable row level security;
alter table plg_daily_reconciliation enable row level security;
alter table plg_restatement_log      enable row level security;
alter table plg_etl_runs             enable row level security;
alter table plg_goals                enable row level security;

-- ── Write RPC: atomic replace of a date window ──────────────────────────────

create or replace function plg_replace_window(
  p_start   date,
  p_end     date,
  p_facts   jsonb,   -- [{day, channel_category, channel, subchannel, sales_tier, quality_segment, n}]
  p_domain  jsonb,   -- [{day, segment, n}]
  p_metrics jsonb    -- [{day, n}]  canonical metrics-table totals
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rows integer;
begin
  delete from plg_daily_facts          where day between p_start and p_end;
  delete from plg_daily_domain_segment where day between p_start and p_end;

  insert into plg_daily_facts (day, channel_category, channel, subchannel, sales_tier, quality_segment, n)
  select (r->>'day')::date, r->>'channel_category', r->>'channel', r->>'subchannel',
         r->>'sales_tier', r->>'quality_segment', (r->>'n')::int
  from jsonb_array_elements(p_facts) r;
  get diagnostics v_rows = row_count;

  insert into plg_daily_domain_segment (day, segment, n)
  select (r->>'day')::date, r->>'segment', (r->>'n')::int
  from jsonb_array_elements(p_domain) r;

  insert into plg_daily_reconciliation (day, facts_total, metrics_total, checked_at)
  select d.day,
         coalesce((select sum(n) from plg_daily_facts f where f.day = d.day), 0),
         (select (m->>'n')::int from jsonb_array_elements(p_metrics) m where (m->>'day')::date = d.day),
         now()
  from generate_series(p_start, p_end, interval '1 day') as d(day)
  on conflict (day) do update
    set facts_total = excluded.facts_total,
        metrics_total = excluded.metrics_total,
        checked_at = excluded.checked_at;

  return jsonb_build_object('fact_rows', v_rows);
end $$;

-- Mon–Sun week totals currently stored, for restatement detection.
create or replace function plg_week_totals(p_start date, p_end date)
returns table (week_start date, total bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('week', day)::date as week_start, sum(n) as total
  from plg_daily_facts
  where day between p_start and p_end
  group by 1
$$;

-- ── Read RPCs ───────────────────────────────────────────────────────────────

-- Everything the dashboard needs for one date range, as a single jsonb blob
-- (avoids PostgREST's 1,000-row cap on set-returning RPCs).
create or replace function plg_range_summary(p_start date, p_end date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('c', channel_category, 'ch', channel, 't', sales_tier, 'n', n))
      from (
        select channel_category, channel, sales_tier, sum(n)::int as n
        from plg_daily_facts where day between p_start and p_end
        group by 1, 2, 3
      ) x), '[]'::jsonb),
    'mcp', coalesce((
      select jsonb_agg(jsonb_build_object('s', subchannel, 'n', n))
      from (
        select subchannel, sum(n)::int as n
        from plg_daily_facts
        where day between p_start and p_end and channel = 'OAuth: MCP'
        group by 1
      ) x), '[]'::jsonb),
    'quality', coalesce((
      select jsonb_agg(jsonb_build_object('q', quality_segment, 'n', n))
      from (
        select quality_segment, sum(n)::int as n
        from plg_daily_facts where day between p_start and p_end
        group by 1
      ) x), '[]'::jsonb),
    'domain', coalesce((
      select jsonb_agg(jsonb_build_object('s', segment, 'n', n))
      from (
        select segment, sum(n)::int as n
        from plg_daily_domain_segment where day between p_start and p_end
        group by 1
      ) x), '[]'::jsonb)
  )
$$;

-- Daily totals + the components the guardrails need.
create or replace function plg_daily_series(p_start date, p_end date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'd', day, 'n', n, 'unattr', unattr, 'hq', hq, 'lowq', lowq) order by day), '[]'::jsonb)
  from (
    select day,
           sum(n)::int                                                                  as n,
           sum(n) filter (where channel = 'unattributable')::int                        as unattr,
           sum(n) filter (where quality_segment = 'non-personal: high quality')::int    as hq,
           sum(n) filter (where quality_segment = 'non-personal: low quality')::int     as lowq
    from plg_daily_facts
    where day between p_start and p_end
    group by day
  ) x
$$;

-- Freshness, recent restatements, reconciliation mismatches, goals.
create or replace function plg_meta()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'min_day', (select min(day) from plg_daily_facts),
    'max_day', (select max(day) from plg_daily_facts),
    'last_run', (select jsonb_build_object('finished_at', finished_at, 'status', status, 'message', message)
                 from plg_etl_runs order by started_at desc limit 1),
    'last_ok_at', (select max(finished_at) from plg_etl_runs where status = 'ok'),
    'restatements', coalesce((
      select jsonb_agg(jsonb_build_object('week_start', week_start, 'old', old_total, 'new', new_total, 'at', detected_at))
      from (select * from plg_restatement_log where detected_at > now() - interval '14 days'
            order by detected_at desc limit 5) r), '[]'::jsonb),
    'recon_mismatches', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'facts', facts_total, 'metrics', metrics_total) order by day)
      from plg_daily_reconciliation
      where day > current_date - 30 and metrics_total is not null and metrics_total <> facts_total), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('label', quarter_label, 'start', quarter_start, 'end', quarter_end,
                                          'scope', scope, 'key', key, 'value', value))
      from plg_goals), '[]'::jsonb)
  )
$$;

revoke all on function plg_replace_window(date, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function plg_week_totals(date, date)  from public, anon, authenticated;
revoke all on function plg_range_summary(date, date) from public, anon, authenticated;
revoke all on function plg_daily_series(date, date)  from public, anon, authenticated;
revoke all on function plg_meta()                   from public, anon, authenticated;
grant execute on function plg_replace_window(date, date, jsonb, jsonb, jsonb) to service_role;
grant execute on function plg_week_totals(date, date)  to service_role;
grant execute on function plg_range_summary(date, date) to service_role;
grant execute on function plg_daily_series(date, date)  to service_role;
grant execute on function plg_meta()                   to service_role;
