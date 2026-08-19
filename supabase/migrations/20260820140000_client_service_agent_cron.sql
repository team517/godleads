-- Run the customer-service agent every 3 min on the support@onepulso.online inbox.
-- The function only handles messages received ≥5 min ago, so a client's reply goes out
-- ~5-8 min later (human-like). Idempotent: cron.schedule upserts by name.
select cron.schedule('client-service-agent-3min', '*/3 * * * *', $$
  select net.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/client-service-agent',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"account_id":"7b97ced3-007b-44b4-846b-49dfb78d8454","limit":10}'::jsonb
  );
$$);
