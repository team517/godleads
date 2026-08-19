-- Run the customer-service agent every 1 min on support@onepulso.online. The 1-min cadence
-- lets the queued copy-change confirmation land reliably 2-3 min after the ack (the function
-- gates it at ≥2 min). Inbound replies still wait ≥5 min (received_at filter) = human delay.
select cron.unschedule('client-service-agent-3min') where exists (select 1 from cron.job where jobname='client-service-agent-3min');
select cron.schedule('client-service-agent-1min', '*/1 * * * *', $$
  select net.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/client-service-agent',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"account_id":"7b97ced3-007b-44b4-846b-49dfb78d8454","limit":10}'::jsonb
  );
$$);
