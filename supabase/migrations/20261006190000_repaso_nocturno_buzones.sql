-- Que no se pierda ningún correo sin que nadie lo sepa (06-10-2026, pedido por el dueño).
--
-- 1) Repaso nocturno: cada día a las 18:30 UTC (20:30 en Madrid en verano, 19:30 en invierno; fuera
--    del horario de envío, que es cuando fetch-inbox hace repasos) se pide a TODOS los buzones
--    conectados un repaso de los últimos 2 días. fetch-inbox compara lo que hay en el buzón con lo
--    guardado y trae lo que falte (inbox_rescan_judge). 12 buzones por pasada y cron: ~2.400 buzones
--    en menos de una hora. No toca el motor de envío.
-- 2) Lo que el repaso recupera queda en inbox_ingest_log con result = 'recuperado'; health_metrics lo
--    expone (recovered_24h) y el monitor de salud avisa por correo cuando pasa de 20 en un día: si el
--    repaso encuentra correos que la sincronización normal no trajo, algo falla en ella.
create or replace function public.request_nightly_inbox_rescan(p_days int default 2)
returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare n int;
begin
  update public.email_accounts
     set imap_rescan = jsonb_build_object('days', greatest(1, least(60, p_days)), 'requested_at', now(), 'why', 'repaso nocturno')
   where status = 'connected'
     and (imap_rescan is null or imap_rescan ? 'done_at');
  get diagnostics n = row_count;
  return n;
end; $fn$;
revoke all on function public.request_nightly_inbox_rescan(int) from public, anon, authenticated;
grant execute on function public.request_nightly_inbox_rescan(int) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'inbox-rescan-nightly';
select cron.schedule('inbox-rescan-nightly', '30 18 * * *', $$select public.request_nightly_inbox_rescan(2)$$);

-- Recuperados en 24 h, para el monitor de salud (misma función, un campo más).
create or replace function public.health_metrics()
 returns json
 language sql
 security definer
 set search_path to 'public'
as $function$
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
    -- Correos que el repaso tuvo que recuperar (estaban en el buzón y no en la plataforma).
    'recovered_24h',        (select count(*) from inbox_ingest_log where result = 'recuperado' and created_at > now()-interval '24 hours'),
    'alerts_enabled',       coalesce((select p.health_alerts_enabled from profiles p join user_roles ur on ur.user_id = p.user_id where ur.role = 'admin' order by p.user_id limit 1), true)
  );
$function$;
