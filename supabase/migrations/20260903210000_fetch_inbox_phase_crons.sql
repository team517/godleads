-- Two more staggered fetch-inbox crons (phase_ratio 0.25 and 0.75) on top of the main cron (0) and
-- phase2 (0.5): 4 windows/min × 150 mailboxes = 600 mailboxes/min → the whole fleet (~1.2k) is
-- checked every ~2 min. Each invocation still opens only CONCURRENCY=4 IMAP sockets and is bounded
-- by the tick time guard + the MAX_MSGS_PER_TICK CPU guard, so this scales coverage without
-- raising per-request load. `phase_ratio` is RELATIVE (floor(windows*ratio)) so the stagger keeps
-- its spacing as the account count changes and can never collide with the main cron.
DO $$ BEGIN PERFORM cron.unschedule('fetch-inbox-phase3-1min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('fetch-inbox-phase4-1min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('fetch-inbox-phase3-1min', '*/1 * * * *', $$
  select net.http_post(
    url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/fetch-inbox',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
    body:='{"phase_ratio":0.25}'::jsonb
  ) as request_id;
$$);

SELECT cron.schedule('fetch-inbox-phase4-1min', '*/1 * * * *', $$
  select net.http_post(
    url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/fetch-inbox',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
    body:='{"phase_ratio":0.75}'::jsonb
  ) as request_id;
$$);
