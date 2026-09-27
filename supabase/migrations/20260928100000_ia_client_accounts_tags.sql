-- ia_client_accounts ahora devuelve también las ETIQUETAS de cada cuenta y por qué está en cada
-- campaña (añadida a mano o por etiqueta), igual que decide el motor: cuentas directas
-- (campaign_accounts) ∪ cuentas cuya lista de tags coincide con campaigns.account_tags
-- (coincidencia exacta, distingue mayúsculas). Sigue sin devolver contraseñas.
drop function if exists public.ia_client_accounts(uuid);

create function public.ia_client_accounts(p_user uuid)
returns table (
  account_id        uuid,
  email             text,
  nombre            text,
  status            text,
  proveedor         text,
  daily_limit       int,
  sent_today        int,
  warmup_enabled    boolean,
  warmup_score      int,
  last_error        text,
  last_sync         timestamptz,
  last_send_at      timestamptz,
  enviados_24h      bigint,
  fallidos_24h      bigint,
  ultimo_fallo      text,
  ultimo_fallo_at   timestamptz,
  tags              text[],
  campanas          text[],
  campanas_directas text[],
  campanas_por_tag  text[],
  campanas_activas  int
)
language sql stable security definer set search_path = public as $$
  with a as (
    select * from email_accounts where user_id = p_user
  ),
  s as (
    select x.account_id,
      count(*) filter (where x.status = 'sent' and x.sent_at >= now() - interval '24 hours') enviados,
      count(*) filter (where x.status = 'failed' and x.created_at >= now() - interval '24 hours') fallidos
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
$$;

revoke all on function public.ia_client_accounts(uuid) from public, anon, authenticated;
grant execute on function public.ia_client_accounts(uuid) to service_role;
