-- Suscripciones de Funnyleads (10-11-2026). El dueño pide: "que cuando pague la suscripción lo
-- detecte; lo mismo con la prueba de 14 días; y cuando se termine y no pague, que le salga un error".
-- user_entitlements ya era la verdad del plan en el servidor (webhook + check-subscription). Aquí se
-- le añade lo que hace falta para distinguir prueba, renovación, impago y baja, y un registro de
-- eventos de Stripe (idempotencia del webhook + rastro para el equipo).

alter table public.user_entitlements add column if not exists trial_end timestamptz;
alter table public.user_entitlements add column if not exists cancel_at_period_end boolean not null default false;
alter table public.user_entitlements add column if not exists billing_interval text;          -- month | year
alter table public.user_entitlements add column if not exists last_payment_error text;
alter table public.user_entitlements add column if not exists last_event_at timestamptz;

-- Lo mismo para los pagos hechos desde la landing antes de tener cuenta.
alter table public.pending_entitlements add column if not exists trial_end timestamptz;
alter table public.pending_entitlements add column if not exists cancel_at_period_end boolean not null default false;
alter table public.pending_entitlements add column if not exists billing_interval text;

-- El trigger que pasa el plan pendiente a la cuenta recién creada, con los campos nuevos.
create or replace function public.claim_pending_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pending_entitlements%rowtype;
begin
  if new.email is null then return new; end if;
  select * into p from public.pending_entitlements where email = lower(new.email);
  if not found then return new; end if;
  insert into public.user_entitlements
    (user_id, tier, status, stripe_customer_id, stripe_subscription_id, extra_client_slots, current_period_end,
     trial_end, cancel_at_period_end, billing_interval, last_event_at)
  values
    (new.id, p.tier, p.status, p.stripe_customer_id, p.stripe_subscription_id, p.extra_client_slots, p.current_period_end,
     p.trial_end, p.cancel_at_period_end, p.billing_interval, now())
  on conflict (user_id) do update set
    tier = excluded.tier, status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
    extra_client_slots = excluded.extra_client_slots, current_period_end = excluded.current_period_end,
    trial_end = excluded.trial_end, cancel_at_period_end = excluded.cancel_at_period_end,
    billing_interval = excluded.billing_interval, last_event_at = now();
  delete from public.pending_entitlements where email = lower(new.email);
  return new;
exception when others then
  raise warning 'claim_pending_entitlement: %', sqlerrm;
  return new;
end;
$$;

-- Registro de eventos de Stripe: idempotencia (stripe_event_id único) y rastro para el equipo.
create table if not exists public.billing_events (
  id               uuid primary key default gen_random_uuid(),
  stripe_event_id  text unique,
  type             text not null,
  user_id          uuid,
  email            text,
  tier             text,
  status           text,
  amount_cents     int,
  currency         text,
  payload          jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists billing_events_created_idx on public.billing_events (created_at desc);
create index if not exists billing_events_user_idx on public.billing_events (user_id) where user_id is not null;

alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
-- Sólo el equipo (admin o gestor de clientes) puede leerlos desde la app; escribe el service role.
drop policy if exists "billing_events staff read" on public.billing_events;
create policy "billing_events staff read" on public.billing_events
  for select to authenticated using (public.is_staff_caller());
grant select on public.billing_events to authenticated;
