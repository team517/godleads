-- Activate the health monitor: schedule the edge function to run every 5 minutes so
-- it actually alerts the owner (team@onepulso.online / ALERT_EMAIL) about problems —
-- auth_failed / IMAP-down accounts, stale syncs, cron failures, a stuck send engine,
-- high bounce rate, etc. The 20260702040000 migration left this cron COMMENTED, so the
-- monitor was never running. Idempotent: unschedule any prior job first, then schedule.
DO $$ BEGIN PERFORM cron.unschedule('health-monitor-every-5-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'health-monitor-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/health-monitor',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
