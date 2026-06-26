-- Schedule the reminder sender every 5 minutes (same pattern/JWT as fetch-inbox cron).
SELECT cron.schedule(
  'send-reminders-every-5-min',
  '*/5 * * * *',
  $$
  select
    net.http_post(
        url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/send-reminders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);
