-- Health monitor: a single SQL snapshot of platform health + a debounce table.
-- The health-monitor edge function (cron every 5 min) reads health_metrics(),
-- evaluates checks, and emails the owner ONLY on anomalies (throttled via
-- health_monitor_state so an ongoing issue re-alerts at most once/hour).

CREATE TABLE IF NOT EXISTS public.health_monitor_state (
  check_key     text PRIMARY KEY,
  failing       boolean NOT NULL DEFAULT true,
  since         timestamptz NOT NULL DEFAULT now(),
  last_notified timestamptz
);
ALTER TABLE public.health_monitor_state ENABLE ROW LEVEL SECURITY; -- service-role only

CREATE OR REPLACE FUNCTION public.health_metrics()
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT json_build_object(
    'hour_madrid',          extract(hour from now() at time zone 'Europe/Madrid')::int,
    'active_campaigns',     (select count(*) from campaigns where status='active'),
    'pending_leads',        (select count(*) from campaign_leads cl join campaigns c on c.id=cl.campaign_id where c.status='active' and cl.status in ('pending','in_progress')),
    'last_send_min_ago',    (select round(extract(epoch from (now()-max(sent_at)))/60)::int from sent_emails where status in ('sent','bounced')),
    'accounts_connected',   (select count(*) from email_accounts where status='connected'),
    'accounts_stale_30m',   (select count(*) from email_accounts where status='connected' and (last_sync is null or last_sync < now()-interval '30 minutes')),
    'accounts_auth_failed', (select count(*) from email_accounts where status='auth_failed'),
    -- OVER-SENDING (personalised cadence → never alert on gaps; alert if it EXCEEDS the plan).
    -- Compare against each account's OWN daily_limit (+15% +5 margin), not a flat 30,
    -- so a legit high-limit account isn't false-flagged and a low-limit overage isn't missed.
    'accounts_over_cap',    (select count(*) from email_accounts where status='connected' and coalesce(daily_limit,0) > 0 and sent_today > (daily_limit*1.15 + 5)),
    'over_cap_detail',      (select coalesce(string_agg(email||' ('||sent_today||'/'||daily_limit||')', ', '),'') from email_accounts where status='connected' and coalesce(daily_limit,0) > 0 and sent_today > (daily_limit*1.15 + 5)),
    'campaigns_over_limit', (select count(*) from campaigns c where c.status='active' and coalesce(c.daily_limit,0) > 0 and (select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date) > (c.daily_limit*1.15+10)),
    'over_limit_detail',    (select coalesce(string_agg(c.name||' ('||(select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date)||'/'||c.daily_limit||')', ', '),'') from campaigns c where c.status='active' and coalesce(c.daily_limit,0)>0 and (select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date) > (c.daily_limit*1.15+10)),
    -- How many active campaigns are supposed to be sending RIGHT NOW (today in their
    -- send_days AND inside their window). Lets the monitor NOT cry "engine dead" on a
    -- weekend / non-send day where zero sends is the CORRECT behaviour.
    'campaigns_scheduled_now', (select count(*) from campaigns c where c.status='active'
        and lower(to_char(now() at time zone coalesce(c.timezone,'Europe/Madrid'), 'Dy')) = any(coalesce(c.send_days, array['mon','tue','wed','thu','fri']))
        and extract(hour from now() at time zone coalesce(c.timezone,'Europe/Madrid'))::int >= coalesce(c.send_start_hour, 9)
        and extract(hour from now() at time zone coalesce(c.timezone,'Europe/Madrid'))::int < coalesce(c.send_end_hour, 18)),
    'inbox_last_hour',      (select count(*) from inbox_messages where received_at > now()-interval '60 minutes'),
    'cron_failures_15m',    (select count(*) from cron.job_run_details where start_time > now()-interval '15 minutes' and status='failed'),
    'zombie_locks',         (select count(*) from processing_locks where locked_until < now()-interval '1 hour'),
    'sent_2h',              (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and status in ('sent','bounced')),
    'bounced_2h',           (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and status='bounced')
  );
$fn$;
REVOKE ALL ON FUNCTION public.health_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_metrics() TO service_role;

-- Cron: run the monitor every 5 minutes.
-- select cron.schedule('health-monitor-every-5-min', '*/5 * * * *',
--   $$ select net.http_post(url:='https://<ref>.supabase.co/functions/v1/health-monitor',
--        headers:='{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb, body:='{}'::jsonb) $$);
