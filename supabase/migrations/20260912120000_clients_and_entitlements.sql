-- ═══════════════════════════════════════════════════════════════════════════════
-- Clientes de usuario + derechos de plan (la primera jerarquía de cuentas del esquema)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- MODELO, y por qué este y no otro:
--
-- Un "cliente" es una entidad DENTRO de la cuenta de su dueño, no un inquilino
-- aparte. Las campañas, los buzones y los leads siguen siendo del dueño
-- (`user_id`), y una campaña solo APUNTA a un cliente. Eso hace que "los envíos
-- de mis clientes van en mi mismo plan" sea cierto por construcción: no hay
-- cuota que sumar entre cuentas porque nunca hay más de una cuenta.
--
-- La alternativa (un auth.users por cliente, como los clientes de la agencia)
-- está descartada a propósito: `profiles.allowed_routes` no vacío deja la cuenta
-- GRATIS para siempre (src/lib/access.ts), así que un usuario de pago creando
-- clientes acuñaría cuentas ilimitadas sin pagar.
--
-- Los derechos de plan viven en `user_entitlements` porque hasta ahora el plan
-- solo existía en el navegador (se calculaba con una llamada a Stripe). Un tope
-- que se comprueba en el cliente no es un tope. Esta tabla la escribe ÚNICAMENTE
-- el servicio (webhook de Stripe / check-subscription).

-- ── Derechos de plan, verdad del servidor ────────────────────────────────────
create table if not exists public.user_entitlements (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  tier                    text not null default 'free',      -- free | starter | growth | scale
  status                  text not null default 'inactive',  -- active | trialing | past_due | canceled | inactive
  stripe_customer_id      text,
  stripe_subscription_id  text,
  -- Plazas de cliente compradas por encima del plan (15 $/mes cada una).
  extra_client_slots      int  not null default 0,
  current_period_end      timestamptz,
  updated_at              timestamptz not null default now()
);

alter table public.user_entitlements enable row level security;

-- El usuario PUEDE leer sus derechos (la interfaz los necesita) y NO puede
-- escribirlos: no hay policy de insert/update/delete para `authenticated`, así
-- que solo el service role los toca.
drop policy if exists "entitlements owner read" on public.user_entitlements;
create policy "entitlements owner read" on public.user_entitlements
  for select using (auth.uid() = user_id);

create index if not exists user_entitlements_customer_idx
  on public.user_entitlements (stripe_customer_id) where stripe_customer_id is not null;

-- ── Clientes ─────────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  company_name   text,
  contact_email  text,
  logo_url       text,
  brand_color    text,
  notes          text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.clients enable row level security;

-- El dueño lee y edita los suyos. El INSERT no tiene policy A PROPÓSITO: crear
-- un cliente consume plaza de plan, así que pasa obligatoriamente por la edge
-- function `clients`, que comprueba el tope con el service role.
drop policy if exists "clients owner read"   on public.clients;
drop policy if exists "clients owner update" on public.clients;
drop policy if exists "clients owner delete" on public.clients;
create policy "clients owner read"   on public.clients for select using (auth.uid() = owner_user_id);
create policy "clients owner update" on public.clients for update using (auth.uid() = owner_user_id)
                                                       with check (auth.uid() = owner_user_id);
create policy "clients owner delete" on public.clients for delete using (auth.uid() = owner_user_id);

-- Un nombre por dueño, sin distinguir mayúsculas, contando solo los activos.
create unique index if not exists clients_owner_name_uniq
  on public.clients (owner_user_id, lower(name)) where archived_at is null;
create index if not exists clients_owner_idx
  on public.clients (owner_user_id) where archived_at is null;

-- ── Enlace campaña → cliente ─────────────────────────────────────────────────
-- Así se atribuyen los envíos: sent_emails ya tiene campaign_id.
alter table public.campaigns add column if not exists client_id uuid
  references public.clients(id) on delete set null;
create index if not exists campaigns_client_idx on public.campaigns (client_id) where client_id is not null;

-- ── Cuántas plazas de cliente tiene un usuario ───────────────────────────────
-- Una sola definición, para que la edge function, la interfaz y cualquier
-- informe no puedan discrepar.
--   starter → 0  (el plan básico no crea clientes)
--   growth  → 5
--   scale   → 10
--   + las plazas extra compradas
-- El personal de la agencia (admin o is_client_manager) no tiene tope: su
-- portal de clientes es anterior a esto y no se toca.
create or replace function public.client_slots_for(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from user_roles  r where r.user_id = p_user_id and r.role = 'admin')
      or exists (select 1 from profiles    p where p.user_id = p_user_id and p.is_client_manager)
      then 100000
    else
      case coalesce((select e.tier from user_entitlements e where e.user_id = p_user_id), 'free')
        when 'scale'  then 10
        when 'growth' then 5
        else 0
      end
      + coalesce((select e.extra_client_slots from user_entitlements e where e.user_id = p_user_id), 0)
  end;
$$;

revoke all on function public.client_slots_for(uuid) from public;
grant execute on function public.client_slots_for(uuid) to authenticated, service_role;

-- ── Resumen para el propietario de la plataforma ─────────────────────────────
-- "Ver los usuarios registrados y cuántos clientes tiene creados cada uno."
-- security definer + comprobación de admin dentro: un usuario normal no la usa.
create or replace function public.admin_users_with_client_counts()
returns table (
  user_id       uuid,
  email         text,
  full_name     text,
  company_name  text,
  created_at    timestamptz,
  tier          text,
  status        text,
  extra_slots   int,
  slots         int,
  clients_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
  order by (select count(*) from clients c2 where c2.owner_user_id = p.user_id and c2.archived_at is null) desc,
           p.created_at desc;
end;
$$;

revoke all on function public.admin_users_with_client_counts() from public;
grant execute on function public.admin_users_with_client_counts() to authenticated;

-- ── updated_at ───────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

drop trigger if exists user_entitlements_touch on public.user_entitlements;
create trigger user_entitlements_touch before update on public.user_entitlements
  for each row execute function public.touch_updated_at();
