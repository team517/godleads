-- ═══════════════════════════════════════════════════════════════════════════════
-- Acceso del cliente: el cliente entra con su usuario y ve SOLO lo suyo
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- El cliente sigue sin ser un inquilino: las campañas son del dueño. Lo que se
-- añade es una cuenta de acceso que sirve para MIRAR, y una lista de qué puede
-- mirar. Los datos no se leen por RLS (eso obligaría a abrir las políticas de
-- todas las tablas a un tercero); se leen por una función de servidor que
-- resuelve auth.uid() → cliente → dueño y devuelve únicamente lo de ese cliente.
--
-- Por qué `client_login_of` en profiles y NO `allowed_routes`: un perfil con
-- allowed_routes no vacío queda GRATIS y con la app completa (src/lib/access.ts),
-- y además vería su propia cuenta vacía, no la de su agencia. Esta columna es una
-- marca explícita: "esta cuenta es el acceso de un cliente, no un usuario".

alter table public.clients
  add column if not exists login_user_id    uuid references auth.users(id) on delete set null,
  add column if not exists allowed_sections text[] not null default '{resumen,campanas}'::text[];

create unique index if not exists clients_login_user_uniq
  on public.clients (login_user_id) where login_user_id is not null;

-- Marca en el perfil de la cuenta de acceso. La escribe sólo el service role.
alter table public.profiles
  add column if not exists client_login_of uuid references public.clients(id) on delete cascade;

create index if not exists profiles_client_login_idx
  on public.profiles (client_login_of) where client_login_of is not null;

-- Nadie puede auto-asignarse esta marca ni quitársela. IMPORTANTE: profiles tiene
-- UNA sola política de UPDATE, y las políticas permisivas se SUMAN con OR — añadir
-- una segunda no restringiría nada. Así que se RECREA la existente añadiendo
-- client_login_of a la lista de columnas congeladas (coins, max_email_accounts,
-- allowed_routes, is_client_manager ya estaban).
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and coins = (select p.coins from public.profiles p where p.user_id = auth.uid())
    and not (max_email_accounts is distinct from (select p.max_email_accounts from public.profiles p where p.user_id = auth.uid()))
    and not (allowed_routes    is distinct from (select p.allowed_routes    from public.profiles p where p.user_id = auth.uid()))
    and not (is_client_manager is distinct from (select p.is_client_manager from public.profiles p where p.user_id = auth.uid()))
    and not (client_login_of   is distinct from (select p.client_login_of   from public.profiles p where p.user_id = auth.uid()))
  );

-- ── Qué ve el cliente, resuelto en el servidor ───────────────────────────────
-- Devuelve el cliente al que pertenece la cuenta que llama, o nada.
create or replace function public.my_client_context()
returns table (
  client_id     uuid,
  owner_user_id uuid,
  name          text,
  company_name  text,
  logo_url      text,
  brand_color   text,
  sections      text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.owner_user_id, c.name, c.company_name, c.logo_url, c.brand_color, c.allowed_sections
  from clients c
  where c.login_user_id = auth.uid() and c.archived_at is null;
$$;

revoke all on function public.my_client_context() from public;
grant execute on function public.my_client_context() to authenticated;

-- ── Las campañas de un cliente, con sus cifras ───────────────────────────────
-- Sirve a los dos lados: al dueño (es su cliente) y a la cuenta de acceso del
-- propio cliente. Cualquier otro no obtiene nada.
create or replace function public.client_campaign_stats(p_client_id uuid)
returns table (
  campaign_id uuid,
  name        text,
  status      text,
  created_at  timestamptz,
  leads       bigint,
  sent        bigint,
  replied     bigint,
  bounced     bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  select c.owner_user_id into v_owner
  from clients c
  where c.id = p_client_id
    and c.archived_at is null
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());

  if v_owner is null then
    return;   -- ni dueño ni cliente: sin datos, sin pistas
  end if;

  return query
  select ca.id, ca.name, ca.status, ca.created_at,
         (select count(*) from campaign_leads cl where cl.campaign_id = ca.id),
         (select count(*) from sent_emails se where se.campaign_id = ca.id and se.sent_at is not null),
         (select count(distinct coalesce(se.lead_id::text, lower(se.to_email)))
            from sent_emails se where se.campaign_id = ca.id and se.replied_at is not null),
         (select count(*) from sent_emails se where se.campaign_id = ca.id and se.bounced_at is not null)
  from campaigns ca
  where ca.client_id = p_client_id and ca.user_id = v_owner
  order by ca.created_at desc;
end;
$$;

revoke all on function public.client_campaign_stats(uuid) from public;
grant execute on function public.client_campaign_stats(uuid) to authenticated;

-- ── Estado de configuración del cliente ──────────────────────────────────────
-- Se DERIVA de las propias columnas, no se guarda un "paso 3 de 4": así nunca
-- queda desincronizado con la realidad.
create or replace function public.client_setup_state(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'datos',    (c.name is not null and c.name <> ''),
    'acceso',   (c.login_user_id is not null),
    'logo',     (coalesce(c.logo_url,'') <> ''),
    'colores',  (coalesce(c.brand_color,'') <> ''),
    'permisos', (coalesce(array_length(c.allowed_sections,1),0) > 0),
    'campanas', (select count(*) > 0 from campaigns ca where ca.client_id = c.id)
  )
  from clients c
  where c.id = p_client_id
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());
$$;

revoke all on function public.client_setup_state(uuid) from public;
grant execute on function public.client_setup_state(uuid) to authenticated;
