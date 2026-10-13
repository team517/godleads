-- Estadísticas segmentadas por campañas (13-10-2026): la gráfica diaria de Estadísticas sólo con
-- las campañas elegidas. Mismas columnas que user_daily_sends (envíos, leads nuevos, follow-ups,
-- respuestas) y misma ventana de días; respeta "Reiniciar analíticas" de cada campaña.
-- Seguridad: sólo cuenta campañas de QUIEN LLAMA; un id ajeno en la lista se ignora.
create or replace function public.campaigns_daily_sends(p_campaign_ids uuid[], p_days integer default 14)
returns table(day date, sends bigint, new_leads bigint, followups bigint, replies bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  c as (
    select id, coalesce(analytics_reset_at, '-infinity'::timestamptz) as since
    from campaigns
    where user_id = auth.uid() and id = any(coalesce(p_campaign_ids, '{}'::uuid[]))),
  first_steps as (
    select cs.campaign_id, (array_agg(cs.id order by cs.step_order asc))[1] as first_step_id
    from campaign_steps cs join c on c.id = cs.campaign_id
    group by cs.campaign_id),
  s as (
    select (se.sent_at at time zone 'Europe/Madrid')::date as day,
      count(*) as n,
      count(*) filter (where se.campaign_step_id is not null and se.campaign_step_id = fs.first_step_id) as new_n
    from c
    join sent_emails se on se.campaign_id = c.id
    left join first_steps fs on fs.campaign_id = se.campaign_id
    where se.user_id = auth.uid() and se.sent_at is not null
      and se.sent_at >= c.since
      and se.sent_at >= (now() - make_interval(days => p_days + 2))
    group by 1),
  r as (
    select (m.received_at at time zone 'Europe/Madrid')::date as day, count(*) as n
    from c
    join inbox_messages m on m.campaign_id = c.id
    where m.user_id = auth.uid() and m.is_archived = false and not coalesce(m.is_warmup, false)
      and m.received_at >= c.since
      and m.received_at >= (now() - make_interval(days => p_days + 2))
    group by 1)
  select d.day,
    coalesce(s.n, 0) as sends,
    coalesce(s.new_n, 0) as new_leads,
    coalesce(s.n, 0) - coalesce(s.new_n, 0) as followups,
    coalesce(r.n, 0) as replies
  from days d
  left join s on s.day = d.day
  left join r on r.day = d.day
  order by d.day;
$function$;
revoke all on function public.campaigns_daily_sends(uuid[], integer) from public;
grant execute on function public.campaigns_daily_sends(uuid[], integer) to authenticated;
notify pgrst, 'reload schema';
