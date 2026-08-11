-- Health monitor noise fix: every ACCOUNT-based check now looks ONLY at mailboxes that
-- are actually in an ACTIVE campaign (assigned directly via campaign_accounts OR by tag
-- overlap account_tags↔tags). Idle/unassigned mailboxes (here 586 of 818) never trigger
-- "not syncing" / "auth failed" / "over cap" alerts anymore.
--
-- Also: the stale-sync signal moves from >30 min → >2 h. With a big fleet the IMAP sync
-- legitimately cycles slower than 30 min per mailbox (healthy: 136 msgs/h arriving, 0
-- in-use mailboxes past 2 h), so 30 min was a chronic false alarm. >2 h = a real outage.
-- New keys: accounts_in_use, accounts_stale_2h. (accounts_stale_30m is dropped.)

CREATE OR REPLACE FUNCTION public.health_metrics()
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH used AS (
    -- connected mailboxes that belong to at least one ACTIVE campaign
    SELECT ea.*
    FROM email_accounts ea
    WHERE ea.status = 'connected'
      AND (
        ea.id IN (SELECT ca.account_id FROM campaign_accounts ca JOIN campaigns c ON c.id = ca.campaign_id WHERE c.status = 'active')
        OR EXISTS (SELECT 1 FROM campaigns c WHERE c.status = 'active' AND c.user_id = ea.user_id
                   AND coalesce(c.account_tags, '{}'::text[]) && coalesce(ea.tags, '{}'::text[]))
      )
  ),
  used_af AS (
    -- auth_failed mailboxes that are (still) assigned to an active campaign
    SELECT ea.*
    FROM email_accounts ea
    WHERE ea.status = 'auth_failed'
      AND (
        ea.id IN (SELECT ca.account_id FROM campaign_accounts ca JOIN campaigns c ON c.id = ca.campaign_id WHERE c.status = 'active')
        OR EXISTS (SELECT 1 FROM campaigns c WHERE c.status = 'active' AND c.user_id = ea.user_id
                   AND coalesce(c.account_tags, '{}'::text[]) && coalesce(ea.tags, '{}'::text[]))
      )
  )
  SELECT json_build_object(
    'hour_madrid',          extract(hour from now() at time zone 'Europe/Madrid')::int,
    'active_campaigns',     (select count(*) from campaigns where status='active'),
    'pending_leads',        (select count(*) from campaign_leads cl join campaigns c on c.id=cl.campaign_id where c.status='active' and cl.status in ('pending','in_progress')),
    'last_send_min_ago',    (select round(extract(epoch from (now()-max(sent_at)))/60)::int from sent_emails where status in ('sent','bounced')),
    'accounts_connected',   (select count(*) from email_accounts where status='connected'),
    'accounts_in_use',      (select count(*) from used),
    'accounts_stale_2h',    (select count(*) from used where last_sync is null or last_sync < now()-interval '2 hours'),
    'accounts_auth_failed', (select count(*) from used_af),
    'accounts_over_cap',    (select count(*) from used where coalesce(daily_limit,0) > 0 and sent_today > (daily_limit*1.15 + 5)),
    'over_cap_detail',      (select coalesce(string_agg(email||' ('||sent_today||'/'||daily_limit||')', ', '),'') from used where coalesce(daily_limit,0) > 0 and sent_today > (daily_limit*1.15 + 5)),
    'campaigns_over_limit', (select count(*) from campaigns c where c.status='active' and coalesce(c.daily_limit,0) > 0 and (select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date) > (c.daily_limit*1.15+10)),
    'over_limit_detail',    (select coalesce(string_agg(c.name||' ('||(select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date)||'/'||c.daily_limit||')', ', '),'') from campaigns c where c.status='active' and coalesce(c.daily_limit,0)>0 and (select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date) > (c.daily_limit*1.15+10)),
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
