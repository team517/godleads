-- Estadísticas: las "respuestas" contaban mensajes de WARM-UP (nuestros propios buzones
-- escribiéndose entre sí) cuando el remitente era de un dominio que también tiene algún lead
-- (gmail.com, por ejemplo). El Unibox los oculta con razón, así que la gráfica decía "3 respuestas"
-- y el Unibox enseñaba 1. Misma regla en los dos sitios.
CREATE OR REPLACE FUNCTION public.user_daily_sends(p_days integer DEFAULT 14)
 RETURNS TABLE(day date, sends bigint, new_leads bigint, followups bigint, replies bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  first_steps as (
    select cs.campaign_id, (array_agg(cs.id order by cs.step_order asc))[1] as first_step_id
    from campaign_steps cs
    where cs.campaign_id in (select id from campaigns where user_id = auth.uid())
    group by cs.campaign_id),
  s as (
    select (se.sent_at at time zone 'Europe/Madrid')::date as day,
      count(*) as n,
      count(*) filter (where se.campaign_step_id is not null and se.campaign_step_id = fs.first_step_id) as new_n
    from sent_emails se
    left join first_steps fs on fs.campaign_id = se.campaign_id
    where se.user_id = auth.uid() and se.sent_at is not null
      and se.sent_at >= (now() - make_interval(days => p_days + 2))
    group by 1),
  r as (
    select (im.received_at at time zone 'Europe/Madrid')::date as day, count(*) as n
    from inbox_messages im
    where im.user_id = auth.uid() and im.is_archived = false
      -- Misma regla que el Unibox: el tráfico de warm-up de nuestros propios buzones no es una
      -- respuesta (venía contando porque "gmail.com" también es el dominio de algún lead).
      and not (coalesce(im.is_warmup, false) and im.lead_id is null and im.campaign_id is null)
      and (
        im.lead_id is not null or im.campaign_id is not null
        or lower(split_part(im.from_email,'@',2)) in (
          select distinct lower(split_part(l.email,'@',2)) from leads l
          where l.user_id = auth.uid() and position('@' in l.email) > 0)
      )
      and im.received_at >= (now() - make_interval(days => p_days + 2))
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
$function$
;

CREATE OR REPLACE FUNCTION public.user_email_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as (
    select sent_at, opened_at, bounced_at, status, lower(to_email) as em
    from sent_emails where user_id = auth.uid()
  ),
  went as (select * from e where sent_at is not null or status in ('sent','bounced'))
  select json_build_object(
    'sent',      (select count(*) from went),
    'contacted', (select count(distinct em) from went where em is not null and em <> ''),
    'bounced', (select count(*) from e where bounced_at is not null or status='bounced'),
    'opened',  (select count(*) from e where opened_at is not null),
    'replied', (select count(*) from inbox_messages m where m.user_id = auth.uid()
                  and m.is_archived = false
                  and not (coalesce(m.is_warmup, false) and m.lead_id is null and m.campaign_id is null)
                  and (
                    m.lead_id is not null or m.campaign_id is not null
                    or lower(split_part(m.from_email,'@',2)) in (
                      select distinct lower(split_part(l.email,'@',2)) from leads l
                      where l.user_id = auth.uid() and position('@' in l.email) > 0)
                  )),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null
                  and em not in (select em from went where em is not null))
  );
$function$
;
