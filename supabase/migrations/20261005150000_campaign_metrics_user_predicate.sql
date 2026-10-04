-- Métricas de campaña: la consulta recorría TODO sent_emails (287k filas, 670 MB).
--
-- campaign_metrics_v2 / campaign_metrics_for_user sólo filtraban sent_emails por el JOIN con las
-- campañas del usuario. Con 6 campañas el planificador elegía un Merge Join que recorre el índice
-- de campaign_id de principio a fin (118k filas de heap, 32k bloques de disco): 14,3 s con la caché
-- fría y 3,2 s con la caché caliente para devolver SEIS filas, casi siempre por encima del
-- statement_timeout de 8 s del rol authenticated → la pantalla de Campañas/Estadísticas "no carga".
--
-- Arreglo: cada campaña se agrega en un LATERAL (un agregado por fila de campaña), que el
-- planificador NO puede aplanar en un merge join: siempre entra por idx_sent_emails_campaign_id con
-- el id de ESA campaña. Medido con la misma caché: 14.260 ms → ~15 ms (support@: 6 campañas sin
-- envíos propios); en las cuentas con envíos reales el coste pasa a ser sólo leer las filas de sus
-- campañas (lo mismo que ya leía la versión anterior). Misma firma, mismas columnas, mismos números
-- (comprobado fila a fila contra la versión anterior en las tres cuentas más grandes).
--
-- Nota: no hace falta índice nuevo (se usa idx_sent_emails_campaign_id). Un predicado extra
-- s.user_id = auth.uid() se probó y se descartó: sin índice (user_id, campaign_id) el planificador
-- añadía un BitmapAnd sobre TODOS los envíos del usuario en cada campaña. La seguridad la da el CTE
-- c (sólo campañas de quien llama), igual que antes.

-- Respeta "Reiniciar analíticas" (campaigns.analytics_reset_at): cada contador mira SU fecha.
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
    x.sent, x.contacted, x.opened, x.bounced, x.replied, x.sender_bounced,
    coalesce(pos.n, 0), coalesce(seq.n, 0)
  from c
  cross join lateral (
    select a.sent, a.contacted, a.opened, a.bounced, a.replied, f.n as sender_bounced
    from (
      -- Una pasada por los envíos de ESTA campaña (índice por campaign_id).
      select
        count(*) filter (where (s.sent_at is not null or s.status = 'sent') and coalesce(s.sent_at, s.created_at) >= c.since) as sent,
        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))
          filter (where (s.sent_at is not null or s.status = 'sent') and coalesce(s.sent_at, s.created_at) >= c.since) as contacted,
        count(*) filter (where s.opened_at is not null and s.opened_at >= c.since) as opened,
        count(*) filter (where s.bounced_at is not null and s.bounced_at >= c.since) as bounced,
        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))
          filter (where s.replied_at is not null and s.replied_at >= c.since) as replied
      from public.sent_emails s
      where s.campaign_id = c.id
    ) a,
    (
      -- "Sender bounced": destinatarios con algún envío fallido y NINGUNO que saliera.
      select count(*) as n
      from (
        select lower(coalesce(s.to_email, '')) as email
        from public.sent_emails s
        where s.campaign_id = c.id
          and coalesce(s.sent_at, s.created_at) >= c.since
          and coalesce(s.to_email, '') <> ''
        group by 1
        having bool_or(s.status = 'failed')
           and not bool_or(s.sent_at is not null or s.status in ('sent', 'bounced'))
      ) g
    ) f
  ) x
  left join pos on pos.campaign_id = c.id
  left join seq on seq.campaign_id = c.id;
$function$;
revoke all on function public.campaign_metrics_v2(uuid) from public;
grant execute on function public.campaign_metrics_v2(uuid) to authenticated;

-- La función de siempre (sin el corte de "Reiniciar"): misma forma. fetch-inbox sólo la vuelve a
-- crear si NO existe, así que esta versión no se pisa.
create or replace function public.campaign_metrics_for_user(p_user_id uuid)
returns table(campaign_id uuid, sent bigint, contacted bigint, opened bigint, bounced bigint, replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with c as (
    select id from public.campaigns where user_id = auth.uid()
  ),
  pos as (
    select im.campaign_id, count(*) as n
    from public.inbox_messages im
    join c on c.id = im.campaign_id
    where im.labels @> array['Interesado']::text[]
    group by im.campaign_id
  ),
  seq as (
    select cs.campaign_id, count(*) as n
    from public.campaign_steps cs
    join c on c.id = cs.campaign_id
    group by cs.campaign_id
  )
  select c.id,
    x.sent, x.contacted, x.opened, x.bounced, x.replied, x.sender_bounced,
    coalesce(pos.n, 0), coalesce(seq.n, 0)
  from c
  cross join lateral (
    select a.sent, a.contacted, a.opened, a.bounced, a.replied, f.n as sender_bounced
    from (
      select
        count(*) filter (where s.sent_at is not null or s.status = 'sent') as sent,
        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))
          filter (where s.sent_at is not null or s.status = 'sent') as contacted,
        count(*) filter (where s.opened_at is not null) as opened,
        count(*) filter (where s.bounced_at is not null) as bounced,
        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))
          filter (where s.replied_at is not null) as replied
      from public.sent_emails s
      where s.campaign_id = c.id
    ) a,
    (
      select count(*) as n
      from (
        select lower(coalesce(s.to_email, '')) as email
        from public.sent_emails s
        where s.campaign_id = c.id
          and coalesce(s.to_email, '') <> ''
        group by 1
        having bool_or(s.status = 'failed')
           and not bool_or(s.sent_at is not null or s.status in ('sent', 'bounced'))
      ) g
    ) f
  ) x
  left join pos on pos.campaign_id = c.id
  left join seq on seq.campaign_id = c.id;
$function$;
revoke all on function public.campaign_metrics_for_user(uuid) from public;
grant execute on function public.campaign_metrics_for_user(uuid) to authenticated;

-- Progreso de las campañas (leads totales / leads ya escritos) en UNA llamada. La lista hacía dos
-- consultas de recuento POR campaña (2N peticiones en paralelo: 1.500 llamadas con picos de 1,8 s).
-- Nueva función aparte para no cambiar las columnas que devuelven las de métricas.
create or replace function public.campaign_lead_counts(p_campaign_ids uuid[])
returns table(campaign_id uuid, leads_total bigint, leads_sent bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select c.id,
         (select count(*) from public.campaign_leads cl where cl.campaign_id = c.id),
         (select count(*) from public.campaign_leads cl where cl.campaign_id = c.id and cl.last_sent_at is not null)
  from public.campaigns c
  where c.user_id = auth.uid()
    and c.id = any(coalesce(p_campaign_ids, '{}'::uuid[]));
$function$;
revoke all on function public.campaign_lead_counts(uuid[]) from public;
grant execute on function public.campaign_lead_counts(uuid[]) to authenticated;
