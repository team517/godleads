-- "Rebotados" = sólo los rebotes por la DIRECCIÓN del lead (06-10-2026).
--
-- Petición del dueño: que en la columna Rebotados no entren errores que no son del lead. Se quedan
-- fuera los rechazos por el lado del EMISOR o por una política del destinatario:
--   * IP de salida en listas negras / reputación (Spamhaus, Barracuda… — IONOS, mout-xforward);
--   * bucles de correo ("Hop count exceeded") y conectores/políticas del destinatario (Microsoft
--     TenantInboundAttribution, "no permite reenvío externo", "unable to receive", "policy").
-- Siguen contando: buzón que no existe, inactivo, dirección rechazada, etc. (lo que de verdad dice
-- que la dirección está mal). Nada se borra: sólo cambia lo que suma la columna.
create or replace function public.bounce_is_lead_fault(p_error text)
returns boolean
language sql immutable
set search_path to 'public'
as $$
  select not (coalesce(p_error, '') ~* (
    'spamhaus|sp ?amhaus|blocked using|block ?list|black ?list|\mrbl\M|dnsbl|reputation|mout-xforward'
    || '|client host|banned|barracuda|sorbs|spamcop|uceprotect|listed (at|in|on|by) '
    || '|hop count exceeded|mail loop|tenantinboundattribution|restrictdomainstoipaddresses'
    || '|external forwarding|unable to ?receive|policy|block ?ed\)'));
$$;
grant execute on function public.bounce_is_lead_fault(text) to authenticated;

create or replace function public.campaign_metrics_v2(p_user_id uuid)
 returns table(campaign_id uuid, sent bigint, contacted bigint, opened bigint, bounced bigint, replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
 language sql
 stable security definer
 set search_path to 'public'
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
        -- Sólo los rebotes por la dirección del lead (ver bounce_is_lead_fault).
        count(*) filter (where s.bounced_at is not null and s.bounced_at >= c.since and public.bounce_is_lead_fault(s.error_message)) as bounced,
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
