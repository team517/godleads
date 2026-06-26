-- Account-level slow ramp + reliable daily reset of sent_today + guaranteed
-- campaign-queue scheduling. Makes campaigns send reliably day after day.

-- 1) Per-account ramp start timestamp (ramp "day" is computed from this, like the
--    campaign ramp uses created_at — no fragile daily counter to increment).
ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz;

-- Refresh the safe view (the frontend reads accounts from it) to expose ramp fields.
DROP VIEW IF EXISTS public.email_accounts_safe;
CREATE VIEW public.email_accounts_safe
WITH (security_invoker = true)
AS
SELECT
  id, user_id, email, first_name, last_name,
  imap_username, imap_host, imap_port,
  smtp_username, smtp_host, smtp_port,
  status, tags, daily_limit, sent_today,
  send_start_hour, send_end_hour, last_send_at,
  warmup_enabled, warmup_day, warmup_limit, warmup_increment, warmup_started_at,
  warmup_score, warmup_status_instantly, warmup_synced_at,
  last_health_check, created_at, updated_at,
  signature_html, last_uid_inbox, last_uid_sent, last_error, last_sync, notes,
  '••••••••'::text AS imap_password,
  '••••••••'::text AS smtp_password
FROM public.email_accounts;
GRANT SELECT ON public.email_accounts_safe TO authenticated;

-- 2) Daily reset of sent_today (00:05 UTC). Idempotent: setting 0 again is harmless,
--    so this is safe even if another reset job already exists.
DO $$ BEGIN PERFORM cron.unschedule('reset-sent-today-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'reset-sent-today-daily',
  '5 0 * * *',
  $$ UPDATE public.email_accounts SET sent_today = 0 WHERE sent_today <> 0; $$
);

-- 3) Guarantee EXACTLY ONE campaign-queue cron. Remove any pre-existing job that
--    calls process-campaign-queue (avoids double-sending), then schedule one.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE command ILIKE '%process-campaign-queue%' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'process-campaign-queue-every-2-min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/process-campaign-queue',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
