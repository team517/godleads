-- Panel que dice la verdad (2/2): por qué una campaña "Activa" no envía.
--
-- Una campaña con status 'active' puede llevar horas sin enviar nada y el panel sólo decía "Activa":
-- sin buzones conectados, fuera de su franja horaria, con todos los buzones en su tope diario, sin
-- leads por escribir... Esta función devuelve, por campaña activa de QUIEN LLAMA, los datos que
-- hacen falta para decirlo (la regla de qué chip enseñar vive en src/lib/campaign-health.ts):
--   * pending_leads / in_progress_leads : campaign_leads por escribir / en secuencia.
--   * total_accounts / connected_accounts / sendable_accounts : buzones de la campaña (directos de
--     campaign_accounts ∪ los que tienen alguna etiqueta de campaigns.account_tags, igual que
--     process-campaign-queue), los conectados, y los conectados con cupo hoy.
--   * sent_today / day_cap : envíos de hoy (medianoche en la zona de la campaña) y tope del día
--     = min(daily_limit de la campaña, suma de topes de buzón), como el motor.
--   * in_window / minutes_into_window : si AHORA cae en send_days + franja send_start..send_end de
--     su zona horaria (franja inválida start>=end = 9-18, como el motor); minutos desde la apertura.
--   * last_sent_at / sent_24h : último envío y envíos en las últimas 24 h.
-- Aproximaciones (siempre del lado de NO dar falsas alarmas): el tope de un buzón se toma como
-- min(daily_limit, 30) sin la rampa de calentamiento ni el slow-ramp de la campaña (que sólo lo
-- bajarían); sent_today del buzón vale 0 si su último envío no fue hoy (el motor lo pone a 0 solo).
-- STABLE + SECURITY DEFINER filtrado por auth.uid(): una sola llamada para toda la pantalla.
create or replace function public.campaign_health_mine()
returns table(
  campaign_id uuid, pending_leads bigint, in_progress_leads bigint,
  total_accounts bigint, connected_accounts bigint, sendable_accounts bigint,
  sent_today bigint, day_cap bigint,
  in_window boolean, minutes_into_window integer,
  last_sent_at timestamptz, sent_24h bigint
)
language sql stable security definer set search_path to 'public'
as $function$
  with tzs as (
    -- Zonas horarias distintas, validadas (una zona inválida rompería la consulta entera).
    select t.timezone as raw,
           case when t.timezone is not null and exists (select 1 from pg_timezone_names z where z.name = t.timezone)
                then t.timezone else 'UTC' end as tz
    from (select distinct timezone from public.campaigns where user_id = auth.uid() and status = 'active') t
  ),
  c as (
    select cm.id, cm.user_id, cm.daily_limit, cm.account_tags, z.tz,
           case when coalesce(cm.send_start_hour, 9) < coalesce(cm.send_end_hour, 18) then coalesce(cm.send_start_hour, 9) else 9 end as sh,
           case when coalesce(cm.send_start_hour, 9) < coalesce(cm.send_end_hour, 18) then coalesce(cm.send_end_hour, 18) else 18 end as eh,
           coalesce(cm.send_days, array['mon','tue','wed','thu','fri']) as send_days,
           (now() at time zone z.tz) as local_now
    from public.campaigns cm
    join tzs z on z.raw is not distinct from cm.timezone
    where cm.user_id = auth.uid() and cm.status = 'active'
  ),
  members as (
    select c.id as cid, ca.account_id as aid
    from c join public.campaign_accounts ca on ca.campaign_id = c.id
    union
    select c.id, a.id
    from c join public.email_accounts a on a.user_id = c.user_id and a.tags && c.account_tags
    where coalesce(cardinality(c.account_tags), 0) > 0
  ),
  acc as (
    select m.cid, a.status,
           least(coalesce(a.daily_limit, 30), 30) as lim,
           case when coalesce(a.sent_today, 0) > 0 and a.last_send_at is not null
                     and (a.last_send_at at time zone c.tz)::date = c.local_now::date
                then a.sent_today else 0 end as st
    from members m
    join c on c.id = m.cid
    join public.email_accounts a on a.id = m.aid and a.user_id = c.user_id
  ),
  agg as (
    select cid,
           count(*) as total_accounts,
           count(*) filter (where status = 'connected') as connected_accounts,
           count(*) filter (where status = 'connected' and st < lim) as sendable_accounts,
           coalesce(sum(lim) filter (where status = 'connected'), 0) as capacity
    from acc group by cid
  )
  select c.id,
         lp.pending, lp.in_progress,
         coalesce(agg.total_accounts, 0)::bigint,
         coalesce(agg.connected_accounts, 0)::bigint,
         coalesce(agg.sendable_accounts, 0)::bigint,
         sx.today::bigint,
         (case when coalesce(c.daily_limit, 0) > 0 then least(c.daily_limit, coalesce(agg.capacity, 0)) else coalesce(agg.capacity, 0) end)::bigint,
         (extract(hour from c.local_now) >= c.sh and extract(hour from c.local_now) < c.eh
            and (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from c.local_now)::int + 1] = any (c.send_days)),
         case when extract(hour from c.local_now) >= c.sh and extract(hour from c.local_now) < c.eh
              then (extract(hour from c.local_now)::int * 60 + extract(minute from c.local_now)::int) - c.sh * 60 end,
         sx.last_at, sx.d24::bigint
  from c
  left join agg on agg.cid = c.id
  cross join lateral (
    select count(*) filter (where cl.status = 'pending') as pending,
           count(*) filter (where cl.status = 'in_progress') as in_progress
    from public.campaign_leads cl
    where cl.campaign_id = c.id and cl.status in ('pending', 'in_progress')
  ) lp
  cross join lateral (
    select count(*) filter (where s.sent_at >= (date_trunc('day', c.local_now) at time zone c.tz)) as today,
           count(*) filter (where s.sent_at >= now() - interval '24 hours') as d24,
           (select max(s2.sent_at) from public.sent_emails s2 where s2.campaign_id = c.id) as last_at
    from public.sent_emails s
    where s.campaign_id = c.id and s.sent_at >= now() - interval '48 hours'
  ) sx;
$function$;
revoke all on function public.campaign_health_mine() from public;
grant execute on function public.campaign_health_mine() to authenticated;
