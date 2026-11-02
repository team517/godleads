-- Resiliencia del motor (02-11-2026), como Smartlead/Instantly ante errores del proveedor:
--  1) Buzón con fallos seguidos del servidor → pausa automática 15/30/60/120 min y vuelve solo.
--  2) Campaña que rebota ≥ 8 % en sus últimos 300 envíos (≥ 20 rebotes de dirección inexistente)
--     → se pausa sola con el motivo visible; el monitor avisa por correo.
alter table public.email_accounts add column if not exists backoff_until timestamptz;
alter table public.email_accounts add column if not exists backoff_level int not null default 0;
alter table public.campaigns add column if not exists auto_paused_at timestamptz;
alter table public.campaigns add column if not exists auto_paused_reason text;

create or replace function public.auto_pause_bouncing_campaigns()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in
    select c.id, c.name, w.total, w.rebotes
    from public.campaigns c
    cross join lateral (
      select count(*) total,
             count(*) filter (where s.bounced_at is not null and public.bounce_is_lead_fault(s.error_message)) rebotes
      from (
        select se.bounced_at, se.error_message
        from public.sent_emails se
        where se.campaign_id = c.id
          and (se.sent_at is not null or se.status in ('sent','bounced'))
          and coalesce(se.sent_at, se.created_at) > coalesce(c.auto_paused_at, '-infinity'::timestamptz)
        order by coalesce(se.sent_at, se.created_at) desc
        limit 300
      ) s
    ) w
    where c.status = 'active'
      and w.total >= 150 and w.rebotes >= 20 and w.rebotes * 100 >= w.total * 8
  loop
    update public.campaigns set status = 'paused', auto_paused_at = now(),
      auto_paused_reason = format('Pausada automáticamente: %s de sus últimos %s envíos rebotaron por dirección inexistente (%s %%). Verifica la lista antes de reactivarla.',
        r.rebotes, r.total, round(100.0 * r.rebotes / r.total, 1))
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.auto_pause_bouncing_campaigns() from public, anon, authenticated;

select cron.unschedule('auto-pause-bouncing') where exists (select 1 from cron.job where jobname = 'auto-pause-bouncing');
select cron.schedule('auto-pause-bouncing', '*/15 * * * *', $$select public.auto_pause_bouncing_campaigns()$$);

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

    'zombie_locks',         public.health_zombie_locks(),

    'sent_2h',              (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and status in ('sent','bounced')),

    'bounced_2h',           (select count(*) from sent_emails where sent_at > now()-interval '2 hours' and (status='bounced' or bounced_at is not null)),

    -- Correos que el repaso tuvo que recuperar (estaban en el buzón y no en la plataforma).

    'recovered_24h',        (select count(*) from inbox_ingest_log where result = 'recuperado' and created_at > now()-interval '24 hours'),

    -- Campañas pausadas solas por rebotes altos (auto_pause_bouncing_campaigns), últimas 24 h.
    'auto_paused_24h',      (select count(*) from campaigns where auto_paused_at > now()-interval '24 hours'),
    'auto_paused_detail',   (select coalesce(string_agg(c.name || ' (' || coalesce(u.email,'') || '): ' || c.auto_paused_reason, ' · '), '') from campaigns c left join auth.users u on u.id = c.user_id where c.auto_paused_at > now()-interval '24 hours'),
    'alerts_enabled',       coalesce((select p.health_alerts_enabled from profiles p join user_roles ur on ur.user_id = p.user_id where ur.role = 'admin' order by p.user_id limit 1), true)

  );

$function$;
