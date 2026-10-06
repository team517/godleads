-- Panel que dice la verdad (1/2): respuestas humanas vs. automáticas y envíos "sin confirmar".
--
-- campaign_metrics_v2.replied cuenta destinatarios con sent_emails.replied_at, y esa marca también la
-- ponen las respuestas automáticas (fuera de oficina, "auto-submitted", etc.). En la columna
-- "Respondidos" se mezclaban personas con autorrespuestas (en las campañas reales, ~2.650 mensajes
-- vinculados a campaña: ~1.350 humanos y ~1.300 automáticos).
--
-- Esta función NUEVA, aparte de campaign_metrics_v2 (misma forma de llamada, no cambia sus columnas ni
-- su firma: la columna `replied` sigue ahí para quien la lea), da por campaña:
--   * replied_human     : destinatarios con AL MENOS un mensaje entrante humano.
--   * replied_auto      : destinatarios que sólo han dado respuestas automáticas.
--                         (replied_human + replied_auto = destinatarios que han contestado algo.)
--   * sent_unconfirmed  : envíos que el servidor aceptó pero cuya confirmación final (tras DATA) se
--                         perdió por timeout. El motor los cuenta como enviados (status 'sent');
--                         "Enviados" = aceptados por el servidor, no entregados.
--
-- Mensaje AUTOMÁTICO = auto_signal no nulo (cabecera Auto-Submitted/X-Autorespond/'subject:auto'...) o
-- etiqueta 'Fuera / Auto' (la IA marca ~1.280 que no traen cabecera). Nunca cuentan: warm-up, copias
-- enviadas (is_sent). Los archivados SÍ cuentan: contestaron igualmente.
-- Respeta "Reiniciar analíticas" (campaigns.analytics_reset_at), igual que campaign_metrics_v2.
-- SEGURIDAD: siempre las campañas de QUIEN LLAMA (auth.uid()).
create or replace function public.campaign_metrics_extra()
returns table(campaign_id uuid, replied_human bigint, replied_auto bigint, sent_unconfirmed bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with c as (
    select id, coalesce(analytics_reset_at, '-infinity'::timestamptz) as since
    from public.campaigns
    where user_id = auth.uid()
  ),
  per_lead as (
    select c.id as campaign_id,
           coalesce(m.lead_id::text, lower(coalesce(m.from_email, ''))) as lead_key,
           bool_or(m.auto_signal is null and not coalesce(m.labels @> array['Fuera / Auto']::text[], false)) as has_human
    from c
    join public.inbox_messages m on m.campaign_id = c.id
    where coalesce(m.is_warmup, false) = false
      and coalesce(m.is_sent, false) = false
      and m.received_at >= c.since
    group by 1, 2
  ),
  rr as (
    select campaign_id,
           count(*) filter (where has_human) as h,
           count(*) filter (where not has_human) as a
    from per_lead
    group by 1
  )
  select c.id,
         coalesce(rr.h, 0)::bigint,
         coalesce(rr.a, 0)::bigint,
         x.n::bigint
  from c
  left join rr on rr.campaign_id = c.id
  cross join lateral (
    select count(*) as n
    from public.sent_emails s
    where s.campaign_id = c.id
      and s.status = 'sent'
      and s.error_message like 'Send unconfirmed%'
      and coalesce(s.sent_at, s.created_at) >= c.since
  ) x;
$function$;
revoke all on function public.campaign_metrics_extra() from public;
grant execute on function public.campaign_metrics_extra() to authenticated;
