-- ¿Es un fallo TEMPORAL del servidor (no del lead ni del buzón)? 4xx de SMTP (421/450/451/452/454),
-- tiempos de espera, cortes de conexión, "try again". 02-11-2026: IONOS dio "454 Temporary
-- authentication failure" a 399 buzones durante una hora; esos intentos se reintentan y NO pueden
-- contar como rebotes ni como errores en ninguna cifra.
create or replace function public.is_temporary_send_error(p_error text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p_error, '') ~* (
    '\m(421|450|451|452|454)\M|\m4\.[0-9]\.[0-9]{1,2}\M|temporar|try again'
    || '|time ?out|timed out|connection (reset|refused|closed|lost)|econnreset|econnrefused|broken pipe'
    || '|greylist|too many (connections|sessions)|service not available|resources temporarily');
$$;


-- (bounce_is_lead_fault NO se toca: hay rebotes reales con código 4.x — el aviso final tras días de
-- reintentos, p. ej. "4.4.1 no acepta conexiones" — y bajarían la columna Rebotados sin motivo.)

-- "Remitentes con fallo" de cada campaña: sin los temporales (se reintentan).
CREATE OR REPLACE FUNCTION public.campaign_metrics_v2(p_user_id uuid)
 RETURNS TABLE(campaign_id uuid, sent bigint, contacted bigint, opened bigint, bounced bigint, replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

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

        -- Enviados / contactados: sólo lo que NO rebotó (un rebote no cuenta como envío).

        count(*) filter (where (s.sent_at is not null or s.status = 'sent') and s.bounced_at is null and coalesce(s.sent_at, s.created_at) >= c.since) as sent,

        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))

          filter (where (s.sent_at is not null or s.status = 'sent') and s.bounced_at is null and coalesce(s.sent_at, s.created_at) >= c.since) as contacted,

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

        having bool_or(s.status = 'failed' and not public.is_temporary_send_error(s.error_message))

           and not bool_or(s.sent_at is not null or s.status in ('sent', 'bounced'))

      ) g

    ) f

  ) x

  left join pos on pos.campaign_id = c.id

  left join seq on seq.campaign_id = c.id;

$function$;

CREATE OR REPLACE FUNCTION public.campaign_metrics_for_user(p_user_id uuid)
 RETURNS TABLE(campaign_id uuid, sent bigint, contacted bigint, opened bigint, bounced bigint, replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        having bool_or(s.status = 'failed' and not public.is_temporary_send_error(s.error_message))
           and not bool_or(s.sent_at is not null or s.status in ('sent', 'bounced'))
      ) g
    ) f
  ) x
  left join pos on pos.campaign_id = c.id
  left join seq on seq.campaign_id = c.id;
$function$;

-- "Fallidos" de Estadísticas / Dashboard: sin los temporales.
CREATE OR REPLACE FUNCTION public.user_email_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as (
    select sent_at, opened_at, bounced_at, status, error_message, lower(to_email) as em
    from sent_emails where user_id = auth.uid()
  ),
  went as (select * from e where sent_at is not null or status in ('sent','bounced'))
  select json_build_object(
    'sent',      (select count(*) from went),
    'contacted', (select count(distinct em) from went where em is not null and em <> ''),
    'bounced', (select count(*) from e where bounced_at is not null or status='bounced'),
    'opened',  (select count(*) from e where opened_at is not null),
    'replied', (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and (m.lead_id is not null or m.campaign_id is not null))
             + (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and m.lead_id is null and m.campaign_id is null and m.is_warmup is not true
                  and (select 1 from leads l
                        where l.user_id = auth.uid() and position('@' in l.email) > 0
                          and lower(split_part(l.email,'@',2)) = lower(split_part(m.from_email,'@',2))
                        limit 1) is not null),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null and not public.is_temporary_send_error(error_message)
                  and em not in (select em from went where em is not null))
  );
$function$;

-- Fallidos por buzón (PulseBot): sin los temporales.
CREATE OR REPLACE FUNCTION public.ia_client_accounts(p_user uuid)
 RETURNS TABLE(account_id uuid, email text, nombre text, status text, proveedor text, daily_limit integer, sent_today integer, warmup_enabled boolean, warmup_score integer, last_error text, last_sync timestamp with time zone, last_send_at timestamp with time zone, enviados_24h bigint, fallidos_24h bigint, ultimo_fallo text, ultimo_fallo_at timestamp with time zone, tags text[], campanas text[], campanas_directas text[], campanas_por_tag text[], campanas_activas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select * from email_accounts where user_id = p_user
  ),
  s as (
    select x.account_id,
      count(*) filter (where x.status = 'sent' and x.sent_at >= now() - interval '24 hours') enviados,
      count(*) filter (where x.status = 'failed' and x.created_at >= now() - interval '24 hours' and not public.is_temporary_send_error(x.error_message)) fallidos
    from sent_emails x join a on a.id = x.account_id
    where x.created_at >= now() - interval '24 hours' or x.sent_at >= now() - interval '24 hours'
    group by x.account_id
  ),
  f as (
    select distinct on (x.account_id) x.account_id, x.error_message, x.created_at
    from sent_emails x join a on a.id = x.account_id
    where x.status = 'failed' and x.created_at >= now() - interval '7 days'
    order by x.account_id, x.created_at desc
  ),
  d as (
    select ca.account_id, array_agg(distinct cp.name) nombres, count(distinct cp.id) filter (where cp.status = 'active') activas, array_agg(distinct cp.id) ids
    from campaign_accounts ca join campaigns cp on cp.id = ca.campaign_id and cp.user_id = p_user
    join a on a.id = ca.account_id
    group by ca.account_id
  ),
  t as (
    select a.id account_id, array_agg(distinct cp.name) nombres, array_agg(distinct cp.id) ids
    from a join campaigns cp on cp.user_id = p_user
      and coalesce(array_length(cp.account_tags, 1), 0) > 0 and a.tags && cp.account_tags
    group by a.id
  ),
  act as (
    select a.id account_id, count(distinct cp.id) n
    from a join campaigns cp on cp.user_id = p_user and cp.status = 'active' and (
      exists (select 1 from campaign_accounts ca where ca.campaign_id = cp.id and ca.account_id = a.id)
      or (coalesce(array_length(cp.account_tags, 1), 0) > 0 and a.tags && cp.account_tags)
    )
    group by a.id
  )
  select a.id, a.email, trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), a.status,
    coalesce(a.smtp_host, ''), a.daily_limit, a.sent_today, a.warmup_enabled, a.warmup_score,
    a.last_error, a.last_sync, a.last_send_at,
    coalesce(s.enviados, 0), coalesce(s.fallidos, 0), f.error_message, f.created_at,
    coalesce(a.tags, '{}'),
    coalesce((select array_agg(distinct x) from unnest(coalesce(d.nombres, '{}') || coalesce(t.nombres, '{}')) x), '{}'),
    coalesce(d.nombres, '{}'), coalesce(t.nombres, '{}'),
    coalesce(act.n, 0)::int
  from a
  left join s on s.account_id = a.id
  left join f on f.account_id = a.id
  left join d on d.account_id = a.id
  left join t on t.account_id = a.id
  left join act on act.account_id = a.id
  order by a.email;
$function$;

-- Freno de IONOS: el 454 "Temporary authentication failure" masivo también es un bloqueo de login.
CREATE OR REPLACE FUNCTION public.ionos_auth_failures(p_minutes integer DEFAULT 5)
 RETURNS TABLE(account_id uuid, user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct s.account_id, s.user_id
  from public.sent_emails s
  join public.email_accounts a on a.id = s.account_id
  where s.status = 'failed'
    and s.created_at > now() - make_interval(mins => greatest(1, least(p_minutes, 60)))
    and s.error_message ~* '\m(535|454)\M'
    and a.smtp_host ~* '(^|\.)(ionos|1and1)\.';
$function$;
