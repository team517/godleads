-- Seguimiento crons: send due follow-ups every minute, and keep team@ inbox fresh every minute.
select cron.schedule('send-followups-1min', '*/1 * * * *', $$
  select net.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/send-followups',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit":20}'::jsonb
  );
$$);
select cron.schedule('fetch-inbox-team-1min', '*/1 * * * *', $$
  select net.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/fetch-inbox',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"account_id":"a638362a-dff1-4d44-9d27-f2e7390d15fc","fetch_limit":100}'::jsonb
  );
$$);
