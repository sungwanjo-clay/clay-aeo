-- pg_cron jobs for daily Edge Function invocation
-- Run once against your Supabase project via the SQL editor.
-- Requires pg_cron and pg_net extensions to be enabled.

-- Enable extensions if not already enabled
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove existing jobs with the same name (idempotent re-run)
select cron.unschedule('refresh-dashboard-cache') where exists (
  select 1 from cron.job where jobname = 'refresh-dashboard-cache'
);
select cron.unschedule('generate-daily-insight') where exists (
  select 1 from cron.job where jobname = 'generate-daily-insight'
);
select cron.unschedule('evaluate-alerts') where exists (
  select 1 from cron.job where jobname = 'evaluate-alerts'
);

-- Schedule: refresh-dashboard-cache at 07:00 UTC daily (midnight PST)
-- Rebuilds the last 14 days of all 6 cache tables (~3-5s).
-- Runs 1 hour before insight generation so the insight job reads fresh cache.
select cron.schedule(
  'refresh-dashboard-cache',
  '0 7 * * *',
  $$ select refresh_dashboard_cache(); $$
);

-- Schedule: generate-daily-insight at 08:00 UTC daily (1am PST)
-- Runs 1 hour after cache refresh to ensure cache is current.
select cron.schedule(
  'generate-daily-insight',
  '0 8 * * *',
  $$
  select net.http_post(
    url    => current_setting('app.supabase_url') || '/functions/v1/generate-daily-insight',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body   => '{}'::jsonb
  );
  $$
);

-- Schedule: evaluate-alerts at 08:05 UTC daily (runs after insight generation)
select cron.schedule(
  'evaluate-alerts',
  '5 8 * * *',
  $$
  select net.http_post(
    url    => current_setting('app.supabase_url') || '/functions/v1/evaluate-alerts',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body   => '{}'::jsonb
  );
  $$
);

-- Verify jobs were created
select jobname, schedule, active from cron.job
where jobname in ('refresh-dashboard-cache', 'generate-daily-insight', 'evaluate-alerts');
