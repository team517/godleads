-- Gráfica diaria de una campaña (campaign_daily_sends): 2 subconsultas correlacionadas POR DÍA, y
-- cada una volvía a recorrer todos los envíos de la campaña porque
-- "(sent_at at time zone 'Europe/Madrid')::date = d.day" no puede usar el índice. En la campaña
-- más grande (25.900 envíos, 14 días): 884 ms y 252k bloques leídos; además la pestaña Analítica la
-- llamaba dos veces (gráfica de 7 días + gráfica de 14).
--
-- Arreglo: un solo recorrido por rango de fechas (índice idx_se_campaign_sent_at) agrupado por día,
-- igual que ya hace user_daily_sends. Medido: 884 ms → 71 ms, mismos números. Respeta "Reiniciar
-- analíticas" (campaigns.analytics_reset_at) como antes. Misma firma y columnas.
create or replace function public.campaign_daily_sends(p_campaign_id uuid, p_days integer default 7)
returns table(day date, sends bigint, replies bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  lim as (
    select coalesce((select analytics_reset_at from campaigns where id = p_campaign_id and user_id = auth.uid()), '-infinity'::timestamptz) as since),
  s as (
    select (s.sent_at at time zone 'Europe/Madrid')::date as day, count(*) as n
    from sent_emails s, lim
    where s.campaign_id = p_campaign_id and s.user_id = auth.uid()
      and s.sent_at is not null and s.sent_at >= lim.since
      -- Ventana por rango (usa el índice); sobra margen de 2 días por la zona horaria.
      and s.sent_at >= (now() - make_interval(days => p_days + 2))
    group by 1),
  r as (
    select (m.received_at at time zone 'Europe/Madrid')::date as day, count(*) as n
    from inbox_messages m, lim
    where m.campaign_id = p_campaign_id and m.user_id = auth.uid()
      and m.is_archived = false and m.received_at >= lim.since
      and m.received_at >= (now() - make_interval(days => p_days + 2))
    group by 1)
  select d.day, coalesce(s.n, 0) as sends, coalesce(r.n, 0) as replies
  from days d
  left join s on s.day = d.day
  left join r on r.day = d.day
  order by d.day;
$function$;
grant execute on function public.campaign_daily_sends(uuid, integer) to authenticated;
