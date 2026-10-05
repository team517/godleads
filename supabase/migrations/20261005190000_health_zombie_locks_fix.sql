-- Monitor de salud: el aviso "lock(s) atascado(s)" era falso (05-10-2026).
-- Contaba como atascado cualquier bloqueo CADUCADO hace más de 1 h, pero un bloqueo caducado está
-- libre: el resumen diario (TTL 20 h) y la alerta del vigilante (TTL 1 h) dejan su fila con la
-- fecha pasada a propósito, y desde el 02-10 el monitor avisaba de "motor bloqueado" sin estarlo.
-- Ahora sólo cuenta lo que de verdad pararía el motor. El resto de la función, idéntico.
CREATE OR REPLACE FUNCTION public.health_metrics()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH used AS (
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
    -- Compare against the ENGINE'S real ceiling (>= 30), not the possibly-stale daily_limit.
    'accounts_over_cap',    (select count(*) from used where sent_today > greatest(coalesce(daily_limit,0), 30)*1.15 + 5),
    'over_cap_detail',      (select coalesce(string_agg(email||' ('||sent_today||'/'||daily_limit||')', ', '),'') from used where sent_today > greatest(coalesce(daily_limit,0), 30)*1.15 + 5),
    'campaigns_over_limit', (select count(*) from campaigns c where c.status='active' and coalesce(c.daily_limit,0) > 0 and (select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date) > (greatest(c.daily_limit, 30)*1.15+10)),
    'over_limit_detail',    (select coalesce(string_agg(c.name||' ('||(select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date)||'/'||c.daily_limit||')', ', '),'') from campaigns c where c.status='active' and coalesce(c.daily_limit,0)>0 and (select count(*) from sent_emails se where se.campaign_id=c.id and se.status in ('sent','bounced') and se.sent_at::date=(now() at time zone 'Europe/Madrid')::date) > (greatest(c.daily_limit, 30)*1.15+10)),
    'campaigns_scheduled_now', (select count(*) from campaigns c where c.status='active'
        and lower(to_char(now() at time zone coalesce(c.timezone,'Europe/Madrid'), 'Dy')) = any(coalesce(c.send_days, array['mon','tue','wed','thu','fri']))
        and extract(hour from now() at time zone coalesce(c.timezone,'Europe/Madrid'))::int >= coalesce(c.send_start_hour, 9)
        and extract(hour from now() at time zone coalesce(c.timezone,'Europe/Madrid'))::int < coalesce(c.send_end_hour, 18)),
    'inbox_last_hour',      (select count(*) from inbox_messages where received_at > now()-interval '60 minutes'),
    'cron_failures_15m',    (select count(*) from cron.job_run_details where runid > (select coalesce(max(runid), 0) - 3000 from cron.job_run_details) and start_time > now()-interval '15 minutes' and status='failed'),
    -- Atascado = un bloqueo que ya no podría caducar a tiempo: el del motor con caducidad a más de
    -- 10 min vista (su TTL es 240 s) o cualquiera a más de 1 día. Un bloqueo CADUCADO está libre.
    'zombie_locks',         (select count(*) from processing_locks where (name = 'process-campaign-queue' and locked_until > now() + interval '10 minutes') or locked_until > now() + interval '1 day'),
    'sent_2h',              (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and status in ('sent','bounced')),
    'bounced_2h',           (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and (status='bounced' or bounced_at is not null)),
    -- Owner toggle: if the admin turned alerts off, the monitor sends nothing.
    'alerts_enabled',       coalesce((select p.health_alerts_enabled from profiles p join user_roles ur on ur.user_id = p.user_id where ur.role = 'admin' order by p.user_id limit 1), true)
  );
$function$;
