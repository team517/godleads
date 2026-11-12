-- Clientes con marca propia y avisos de consumo del plan (12-11-2026).
--
-- 1) Marca de la AGENCIA (el usuario de pago que crea clientes): nombre, logo, color y un
--    "slug" único → su entrada exclusiva para clientes: https://www.funnyleads.com/acceso/<slug>.
--    La lee cualquiera (la página de acceso es pública) SOLO por la función
--    client_login_branding(slug), que devuelve nombre/logo/color y nada más.
-- 2) La marca del CLIENTE (clients.logo_url / brand_color) se copia al perfil de su cuenta de
--    acceso: la aplicación ya pinta profile.logo_url y profile.brand_color (barra superior,
--    menú y color principal), así que el cliente entra y ve SU logo y SU color.
-- 3) Secciones por defecto de un cliente nuevo: el panel completo (puede crear campañas,
--    conectar buzones, subir leads, Unibox, estadísticas e IA).
-- 4) plan_usage_alerts: un aviso por umbral (80/95/100 %) y por mes, para no repetir correos.

-- ── 1. Marca de la agencia ───────────────────────────────────────────────────────────────
create table if not exists public.agency_branding (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  agency_name text check (agency_name is null or length(agency_name) <= 80),
  logo_url text check (logo_url is null or length(logo_url) <= 1000),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agency_branding enable row level security;
-- El dueño lee la suya; escribir sólo por la edge function `clients` (service role).
drop policy if exists "agency branding owner read" on public.agency_branding;
create policy "agency branding owner read" on public.agency_branding
  for select to authenticated using (auth.uid() = owner_user_id);

-- Lo mínimo para pintar la página de acceso. Pública a propósito: no revela quién es el dueño.
create or replace function public.client_login_branding(p_slug text)
returns table(agency_name text, logo_url text, brand_color text)
language sql stable security definer set search_path = public as $$
  select a.agency_name, a.logo_url, a.brand_color
  from agency_branding a
  where a.slug = lower(trim(p_slug));
$$;
revoke all on function public.client_login_branding(text) from public;
grant execute on function public.client_login_branding(text) to anon, authenticated;

-- ¿La cuenta con sesión es una cuenta de cliente de ESA agencia?
create or replace function public.client_login_belongs(p_slug text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    join agency_branding a on a.owner_user_id = c.owner_user_id
    where a.slug = lower(trim(p_slug))
      and c.login_user_id = auth.uid()
      and c.archived_at is null
  );
$$;
revoke all on function public.client_login_belongs(text) from public;
grant execute on function public.client_login_belongs(text) to authenticated;

-- La entrada de la agencia de la cuenta de cliente con sesión (para volver a ella al salir).
create or replace function public.my_client_agency_slug()
returns text
language sql stable security definer set search_path = public as $$
  select a.slug from clients c
  join agency_branding a on a.owner_user_id = c.owner_user_id
  where c.login_user_id = auth.uid() and c.archived_at is null
  limit 1;
$$;
revoke all on function public.my_client_agency_slug() from public;
grant execute on function public.my_client_agency_slug() to authenticated;

-- ── 2. La marca del cliente, en el perfil de su cuenta de acceso ────────────────────────
create or replace function public.sync_client_brand_to_login()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.login_user_id is not null then
    update profiles
       set logo_url = nullif(trim(coalesce(new.logo_url, '')), ''),
           brand_color = nullif(trim(coalesce(new.brand_color, '')), ''),
           company_name = coalesce(nullif(trim(coalesce(new.company_name, '')), ''), new.name)
     where user_id = new.login_user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists clients_brand_to_login on public.clients;
create trigger clients_brand_to_login
  after insert or update of name, company_name, logo_url, brand_color, login_user_id
  on public.clients
  for each row execute function public.sync_client_brand_to_login();

-- Las cuentas de cliente que ya existen, al día.
update profiles p
   set logo_url = nullif(trim(coalesce(c.logo_url, '')), ''),
       brand_color = nullif(trim(coalesce(c.brand_color, '')), ''),
       company_name = coalesce(nullif(trim(coalesce(c.company_name, '')), ''), c.name)
  from clients c
 where c.login_user_id = p.user_id;

-- ── 3. Panel completo por defecto ─────────────────────────────────────────────────────────
alter table public.clients
  alter column allowed_sections set default '{dashboard,cuentas,campanas,leads,unibox,estadisticas,ia}'::text[];

-- ── 4. Avisos de consumo del plan ────────────────────────────────────────────────────────
create table if not exists public.plan_usage_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  threshold int not null check (threshold in (80, 95, 100)),
  sent_count bigint not null default 0,
  limit_count bigint not null default 0,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, period_start, threshold)
);
alter table public.plan_usage_alerts enable row level security;
drop policy if exists "plan usage alerts owner read" on public.plan_usage_alerts;
create policy "plan usage alerts owner read" on public.plan_usage_alerts
  for select to authenticated using (auth.uid() = user_id);

-- Permisos de tabla: sólo lectura para usuarios con sesión (RLS: cada uno la suya). El anónimo,
-- nada (la página de acceso usa client_login_branding). Escribir: sólo el service role.
revoke all on public.agency_branding from anon, authenticated;
revoke all on public.plan_usage_alerts from anon, authenticated;
grant select on public.agency_branding to authenticated;
grant select on public.plan_usage_alerts to authenticated;
