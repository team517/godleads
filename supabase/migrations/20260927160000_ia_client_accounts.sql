-- Modificaciones IA: las cuentas de correo de un cliente con su salud, de una sola vez.
-- Sólo datos de estado: NUNCA contraseñas ni usuarios IMAP/SMTP. Sólo el service role.
create or replace function public.ia_client_accounts(p_user uuid)
returns table (
  account_id      uuid,
  email           text,
  nombre          text,
  status          text,
  proveedor       text,
  daily_limit     int,
  sent_today      int,
  warmup_enabled  boolean,
  warmup_score    int,
  last_error      text,
  last_sync       timestamptz,
  last_send_at    timestamptz,
  enviados_24h    bigint,
  fallidos_24h    bigint,
  ultimo_fallo    text,
  ultimo_fallo_at timestamptz,
  campanas        text[],
  campanas_activas int
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
  c as (
    select a.id account_id,
      array_agg(distinct cp.name) filter (where cp.id is not null) nombres,
      count(distinct cp.id) filter (where cp.status = 'active') activas
    from a
    left join campaigns cp on cp.user_id = p_user and (
      exists (select 1 from campaign_accounts ca where ca.campaign_id = cp.id and ca.account_id = a.id)
      or (coalesce(array_length(cp.account_tags, 1), 0) > 0 and a.tags && cp.account_tags)
    )
    group by a.id
  )
  select a.id, a.email, trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), a.status,
    coalesce(a.smtp_host, ''), a.daily_limit, a.sent_today, a.warmup_enabled, a.warmup_score,
    a.last_error, a.last_sync, a.last_send_at,
    coalesce(s.enviados, 0), coalesce(s.fallidos, 0), f.error_message, f.created_at,
    coalesce(c.nombres, '{}'), coalesce(c.activas, 0)::int
  from a
  left join s on s.account_id = a.id
  left join f on f.account_id = a.id
  left join c on c.account_id = a.id
  order by a.email;
$$;

revoke all on function public.ia_client_accounts(uuid) from public, anon, authenticated;
grant execute on function public.ia_client_accounts(uuid) to service_role;
