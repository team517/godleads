-- Estadísticas (user_email_stats, user_daily_sends): la cuenta de "respuestas" tardaba ~1 s por
-- culpa de la subconsulta "dominio del remitente IN (dominios distintos de TODOS mis leads)": con
-- 246k leads recorría el índice entero, calculaba split_part en cada fila y agregaba 56k dominios…
-- para decidir sobre ~1.000 mensajes sin lead ni campaña. Las dos funciones la ejecutaban a la vez al
-- abrir Estadísticas (y el Dashboard otra vez), y bajo carga pasaban del statement_timeout de 8 s.
--
-- Arreglo: EXISTS por mensaje contra el índice idx_leads_user_domain (user_id, dominio), que ya
-- existe. Medido en support@: 1.086 ms → 61 ms con el MISMO resultado (1.298 = 1.298). Misma regla:
-- "lead con '@' cuyo dominio coincide" ≡ "dominio en la lista de dominios de leads con '@'".
-- Firmas, columnas, STABLE/SECURITY DEFINER y permisos sin cambios.

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
      and im.received_at >= (now() - make_interval(days => p_days + 2))
      -- Misma regla que el Unibox: cuenta si está ligado a un lead/campaña, o si (no siendo
      -- warm-up) el dominio del remitente es el de alguno de mis leads.
      and (
        im.lead_id is not null or im.campaign_id is not null
        or (not coalesce(im.is_warmup, false) and exists (
          select 1 from leads l
          where l.user_id = im.user_id
            and position('@' in l.email) > 0
            and lower(split_part(l.email,'@',2)) = lower(split_part(im.from_email,'@',2))))
      )
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
grant execute on function public.user_daily_sends(integer) to authenticated;

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
                  and (
                    m.lead_id is not null or m.campaign_id is not null
                    or (not coalesce(m.is_warmup, false) and exists (
                      select 1 from leads l
                      where l.user_id = m.user_id
                        and position('@' in l.email) > 0
                        and lower(split_part(l.email,'@',2)) = lower(split_part(m.from_email,'@',2))))
                  )),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null
                  and em not in (select em from went where em is not null))
  );
$function$
;
grant execute on function public.user_email_stats() to authenticated;
