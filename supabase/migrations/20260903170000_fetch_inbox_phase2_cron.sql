-- 2nd staggered fetch-inbox cron to halve Unibox sync latency.
-- With ~1.1k connected mailboxes and one rotating-window cron (batch 35), the full-cover cycle was
-- ~34 min. Adding a second cron at phase=17 (the opposite half of the rotation) covers TWO windows
-- per minute → ~17 min cycle — WITHOUT raising per-invocation IMAP concurrency (each cron still opens
-- only CONCURRENCY=4 sockets). fetch-inbox reads body.phase and shifts its rotating-window offset by it.
SELECT cron.schedule(
  'fetch-inbox-phase2-1min',
  '*/1 * * * *',
  $$
  select net.http_post(
    url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/fetch-inbox',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
    body:='{"phase_ratio":0.5}'::jsonb
  ) as request_id;
  $$
);
