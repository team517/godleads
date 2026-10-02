-- El monitor de salud llevaba parado sin que nadie lo supiera (02-10-2026): health_metrics tardaba
-- 10 s y PostgREST corta a los 8 s, así que cada pasada fallaba antes de comprobar nada.
--  · La causa: contar los fallos de cron recorría cron.job_run_details entera (~850.000 filas, sin
--    índice por fecha): 7,9 s. Ahora sólo mira las últimas 3.000 ejecuciones por su número.
--  · bounced_2h cuenta también los rebotes que llegan después como aviso al buzón (bounced_at):
--    antes sólo veía los rechazos en el momento del envío y la alerta de rebote alto era ciega.
--  · Dos índices por fecha para las otras dos consultas lentas (en producción se crearon con
--    CREATE INDEX CONCURRENTLY).
create index if not exists idx_sent_emails_sent_at on public.sent_emails (sent_at);
create index if not exists idx_inbox_messages_received_at on public.inbox_messages (received_at);

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
    'zombie_locks',         (select count(*) from processing_locks where locked_until < now()-interval '1 hour'),
    'sent_2h',              (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and status in ('sent','bounced')),
    'bounced_2h',           (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and (status='bounced' or bounced_at is not null)),
    -- Owner toggle: if the admin turned alerts off, the monitor sends nothing.
    'alerts_enabled',       coalesce((select p.health_alerts_enabled from profiles p join user_roles ur on ur.user_id = p.user_id where ur.role = 'admin' order by p.user_id limit 1), true)
  );
$function$;
