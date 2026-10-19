-- Freno ante un bloqueo de login de IONOS (19-10-2026). Ver supabase/functions/_shared/auth-storm.ts.
-- engine_flags: interruptores del motor con caducidad (p. ej. 'ionos_auth_pause' hasta una hora).
-- Sólo el service role (motor, monitor) la lee y escribe.
create table if not exists public.engine_flags (
  key text primary key,
  until timestamptz,
  reason text,
  updated_at timestamptz not null default now()
);
alter table public.engine_flags enable row level security;
revoke all on public.engine_flags from anon, authenticated;

-- Buzones de IONOS con un 535 en los últimos p_minutes minutos (cuenta y cliente), para decidir si
-- es un bloqueo del proveedor (muchos buzones de varios clientes) o contraseñas malas.
create or replace function public.ionos_auth_failures(p_minutes integer default 5)
returns table(account_id uuid, user_id uuid)
language sql stable security definer set search_path to 'public'
as $$
  select distinct s.account_id, s.user_id
  from public.sent_emails s
  join public.email_accounts a on a.id = s.account_id
  where s.status = 'failed'
    and s.created_at > now() - make_interval(mins => greatest(1, least(p_minutes, 60)))
    and s.error_message ~* '\m535\M'
    and a.smtp_host ~* '(^|\.)(ionos|1and1)\.';
$$;
revoke all on function public.ionos_auth_failures(integer) from public, anon, authenticated;
grant execute on function public.ionos_auth_failures(integer) to service_role;
