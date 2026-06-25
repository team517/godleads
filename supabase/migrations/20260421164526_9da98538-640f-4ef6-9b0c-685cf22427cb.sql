-- Reschedule fetch-inbox to run every 2 minutes for fresher inbox sync
SELECT cron.unschedule('fetch-inbox-every-5-min');

SELECT cron.schedule(
  'fetch-inbox-every-2-min',
  '*/2 * * * *',
  $$
  select
    net.http_post(
        url:='https://acruteihiwyrzovcdjty.supabase.co/functions/v1/fetch-inbox',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjcnV0ZWloaXd5cnpvdmNkanR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzY0NDUsImV4cCI6MjA4NzQxMjQ0NX0.V0VdLgbc3Ivj3UNLSneX6CpwQNQmYVXqdumGpgM2Szc"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);