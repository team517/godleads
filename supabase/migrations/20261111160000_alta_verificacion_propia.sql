-- Alta de Funnyleads con verificación propia (11-11-2026).
-- El correo de confirmación ya no lo manda Supabase (enlace a *.supabase.co que Gmail marca como
-- peligroso): lo manda team@ con un botón a www.funnyleads.com/empezar/verificar?t=…
-- Aquí se guardan esos enlaces (sólo la huella SHA-256 del token, nunca el token).
create table if not exists public.signup_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  plan text,
  period text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_signup_verifications_user on public.signup_verifications (user_id, created_at desc);
alter table public.signup_verifications enable row level security;
-- Sin políticas: sólo el service role (función signup-flow) la toca.

-- Buscar una cuenta por correo desde la función de alta (service role). No se expone a la web.
create or replace function public.signup_user_by_email(p_email text)
returns table (id uuid, email_confirmed_at timestamptz, created_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select u.id, u.email_confirmed_at, u.created_at
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;
revoke all on function public.signup_user_by_email(text) from public, anon, authenticated;
grant execute on function public.signup_user_by_email(text) to service_role;

-- "Hasta que no pone la tarjeta no está registrado": un alta propia desde el 11-11-2026 que nunca ha
-- tenido suscripción (ninguna fila en user_entitlements) es un alta A MEDIAS. No sale en las listas
-- de usuarios del panel de admin. Mismo corte que la app (CARD_REQUIRED_CUTOFF_MS en access.ts).
-- Fuera de esta regla: equipo (user_roles con rol distinto de 'user' o 'client'), clientes de la agencia (allowed_routes) y accesos de
-- cliente (client_login_of).
create or replace function public.is_pending_signup(p_user uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where u.id = p_user
      and u.created_at >= timestamptz '2026-11-11 00:00:00+00'
      and not exists (select 1 from public.user_entitlements e where e.user_id = u.id)
      and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role::text not in ('user', 'client'))
      and coalesce(array_length(p.allowed_routes, 1), 0) = 0
      and p.client_login_of is null
  );
$$;
revoke all on function public.is_pending_signup(uuid) from public, anon;
grant execute on function public.is_pending_signup(uuid) to authenticated, service_role;

create or replace function public.admin_users_with_client_counts()
 returns table(user_id uuid, email text, full_name text, company_name text, created_at timestamp with time zone, tier text, status text, extra_slots integer, slots integer, clients_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin') then
    raise exception 'forbidden';
  end if;

  return query
  select p.user_id,
         p.contact_email,
         p.full_name,
         p.company_name,
         p.created_at,
         coalesce(e.tier, 'free'),
         coalesce(e.status, 'inactive'),
         coalesce(e.extra_client_slots, 0),
         public.client_slots_for(p.user_id),
         (select count(*) from clients c where c.owner_user_id = p.user_id and c.archived_at is null)
  from profiles p
  left join user_entitlements e on e.user_id = p.user_id
  -- Altas a medias (sin tarjeta todavía): no cuentan como usuarios registrados (11-11-2026).
  where not public.is_pending_signup(p.user_id)
  order by (select count(*) from clients c2 where c2.owner_user_id = p.user_id and c2.archived_at is null) desc,
           p.created_at desc;
end;
$function$;
