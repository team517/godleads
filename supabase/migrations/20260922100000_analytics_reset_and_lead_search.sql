-- 1) REINICIAR LAS ANALÍTICAS de una campaña SIN BORRAR NADA.
--    Borrar sent_emails rompería el motor (no repetir un paso, el hilo de los seguimientos, el
--    slow-ramp, los límites diarios) y vaciaría el Unibox. Así que "reiniciar" es una marca de
--    tiempo: los contadores sólo cuentan lo ocurrido DESPUÉS. Poner la marca a null = ver de nuevo
--    el histórico completo.
alter table public.campaigns add column if not exists analytics_reset_at timestamptz;

-- Misma forma que campaign_metrics_for_user, con el corte. Nombre NUEVO a propósito: fetch-inbox
-- lleva una copia de la función vieja en su arranque de emergencia y la volvería a pisar.
create or replace function public.campaign_metrics_v2(p_user_id uuid)
returns table(campaign_id uuid, sent bigint, contacted bigint, opened bigint, bounced bigint, replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with c as (
    -- SEGURIDAD: siempre las campañas de QUIEN LLAMA; p_user_id sólo está por la firma.
    select id, coalesce(analytics_reset_at, '-infinity'::timestamptz) as since
    from public.campaigns
    where user_id = auth.uid()
  ),
  se as (
    select s.campaign_id, c.since,
           lower(coalesce(s.to_email, '')) as email,
           s.status, s.sent_at, s.opened_at, s.replied_at, s.bounced_at, s.lead_id, s.created_at
    from public.sent_emails s
    join c on c.id = s.campaign_id
    -- Cada contador mira SU fecha: un correo enviado antes del reinicio que se responde después
    -- cuenta como respuesta nueva, pero no como envío nuevo.
    where greatest(coalesce(s.sent_at, s.created_at), coalesce(s.replied_at, '-infinity'), coalesce(s.bounced_at, '-infinity'), coalesce(s.opened_at, '-infinity')) >= c.since
  ),
  okmail as (
    select campaign_id, email,
           bool_or(sent_at is not null or status in ('sent','bounced')) as ok
    from se where coalesce(sent_at, created_at) >= since
    group by campaign_id, email
  ),
  failed as (
    select se.campaign_id, count(distinct se.email) as n
    from se
    join okmail o on o.campaign_id = se.campaign_id and o.email = se.email
    where se.status = 'failed' and o.ok = false and se.email <> '' and coalesce(se.sent_at, se.created_at) >= se.since
    group by se.campaign_id
  ),
  agg as (
    select campaign_id,
      count(*) filter (where (sent_at is not null or status = 'sent') and coalesce(sent_at, created_at) >= since) as sent,
      count(distinct coalesce(lead_id::text, email))
        filter (where (sent_at is not null or status = 'sent') and coalesce(sent_at, created_at) >= since)       as contacted,
      count(*) filter (where opened_at is not null and opened_at >= since)                                       as opened,
      count(*) filter (where bounced_at is not null and bounced_at >= since)                                     as bounced,
      count(distinct coalesce(lead_id::text, email))
        filter (where replied_at is not null and replied_at >= since)                                            as replied
    from se group by campaign_id
  ),
  pos as (
    select im.campaign_id, count(*) as n
    from public.inbox_messages im
    join c on c.id = im.campaign_id
    where im.labels @> array['Interesado']::text[] and im.received_at >= c.since
    group by im.campaign_id
  ),
  seq as (
    select cs.campaign_id, count(*) as n
    from public.campaign_steps cs
    join c on c.id = cs.campaign_id
    group by cs.campaign_id
  )
  select c.id,
    coalesce(agg.sent, 0), coalesce(agg.contacted, 0), coalesce(agg.opened, 0), coalesce(agg.bounced, 0),
    coalesce(agg.replied, 0), coalesce(failed.n, 0), coalesce(pos.n, 0), coalesce(seq.n, 0)
  from c
  left join agg    on agg.campaign_id    = c.id
  left join failed on failed.campaign_id = c.id
  left join pos    on pos.campaign_id    = c.id
  left join seq    on seq.campaign_id    = c.id;
$function$;
revoke all on function public.campaign_metrics_v2(uuid) from public;
grant execute on function public.campaign_metrics_v2(uuid) to authenticated;

-- La gráfica diaria respeta el mismo corte (misma firma: es un reemplazo limpio).
create or replace function public.campaign_daily_sends(p_campaign_id uuid, p_days integer default 7)
returns table(day date, sends bigint, replies bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  lim as (
    select coalesce((select analytics_reset_at from campaigns where id = p_campaign_id and user_id = auth.uid()), '-infinity'::timestamptz) as since)
  select d.day,
    (select count(*) from sent_emails s, lim where s.campaign_id=p_campaign_id and s.user_id=auth.uid()
       and s.sent_at is not null and s.sent_at >= lim.since
       and (s.sent_at at time zone 'Europe/Madrid')::date = d.day) as sends,
    (select count(*) from inbox_messages m, lim where m.campaign_id=p_campaign_id and m.user_id=auth.uid()
       and m.is_archived = false and m.received_at >= lim.since
       and (m.received_at at time zone 'Europe/Madrid')::date = d.day) as replies
  from days d order by d.day;
$function$;

-- 2) BUSCAR LEADS en TODA la cuenta, también los que sólo viven dentro de una campaña
--    (is_campaign_only), que la pantalla de Leads no enseña. Busca en el email, en los campos
--    del lead y en el nombre de la campaña, y devuelve en qué campañas está cada uno.
create or replace function public.search_my_leads(p_q text, p_limit integer default 100, p_offset integer default 0)
returns table(id uuid, email text, custom_fields jsonb, status text, verification_status text, list_id uuid,
              list_name text, is_campaign_only boolean, created_at timestamptz, campaigns jsonb, total bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with q as (
    select '%' || replace(replace(replace(lower(btrim(coalesce(p_q, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           length(btrim(coalesce(p_q, ''))) as len
  ),
  camp as (
    select c.id from public.campaigns c, q where c.user_id = auth.uid() and q.len >= 2 and lower(c.name) like q.pat
  ),
  m as (
    select l.*
    from public.leads l, q
    where l.user_id = auth.uid() and q.len >= 2
      and ( lower(l.email) like q.pat
         or lower(l.custom_fields::text) like q.pat
         or exists (select 1 from public.campaign_leads cl where cl.lead_id = l.id and cl.campaign_id in (select id from camp)) )
  )
  select m.id, m.email, m.custom_fields, m.status, m.verification_status, m.list_id,
         ll.name, coalesce(m.is_campaign_only, false), m.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', cl.status, 'step', cl.current_step) order by c.name)
                   from public.campaign_leads cl join public.campaigns c on c.id = cl.campaign_id
                   where cl.lead_id = m.id), '[]'::jsonb),
         (select count(*) from m)
  from m
  left join public.lead_lists ll on ll.id = m.list_id
  order by m.created_at desc, m.id
  limit greatest(1, least(coalesce(p_limit, 100), 500)) offset greatest(0, coalesce(p_offset, 0));
$function$;
revoke all on function public.search_my_leads(text, integer, integer) from public;
grant execute on function public.search_my_leads(text, integer, integer) to authenticated;
