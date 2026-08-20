-- Dedicated 1-min sync for the customer-service inbox support@onepulso.online, so its
-- replies land in inbox_messages INSTANTLY (fast Automatización Unibox + fast AI answers)
-- instead of waiting ~13-18 min for the rotating window (120+ mailboxes). fetch-inbox now
-- accepts body.account_id on the anon path to sync only that mailbox; it is verify_jwt=false
-- so no Authorization header is needed.
select cron.schedule('fetch-inbox-support-1min', '*/1 * * * *', $$
  select net.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/fetch-inbox',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"account_id":"7b97ced3-007b-44b4-846b-49dfb78d8454","fetch_limit":80}'::jsonb
  );
$$);
