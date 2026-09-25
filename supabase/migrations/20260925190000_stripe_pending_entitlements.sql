-- Pagar desde la landing ANTES de tener cuenta.
--
-- El botón "Choose" de la landing lleva directo al enlace de pago de Stripe. Quien paga ahí aún
-- no tiene usuario: el webhook recibe la suscripción con el correo del pago y no encuentra a
-- nadie. Antes ese evento se perdía ("customer sin usuario") y la persona, al registrarse
-- después, se quedaba sin plan. Ahora el plan se guarda aquí por correo y se le asigna en el
-- momento en que se crea su cuenta con ese mismo correo.

create table if not exists public.pending_entitlements (
  email                   text primary key,          -- en minúsculas
  tier                    text not null,
  status                  text not null,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  extra_client_slots      int  not null default 0,
  current_period_end      timestamptz,
  updated_at              timestamptz not null default now()
);

-- Nadie la lee ni la escribe desde el navegador: sólo el service role (webhook) y el trigger.
alter table public.pending_entitlements enable row level security;

-- Del correo al usuario: el webhook busca por el correo de ACCESO (auth.users), no sólo por el
-- de contacto del perfil, que casi nadie rellena.
create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

-- Al crearse la cuenta: si ese correo ya había pagado, el plan pasa a la cuenta.
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
    (user_id, tier, status, stripe_customer_id, stripe_subscription_id, extra_client_slots, current_period_end)
  values
    (new.id, p.tier, p.status, p.stripe_customer_id, p.stripe_subscription_id, p.extra_client_slots, p.current_period_end)
  on conflict (user_id) do update set
    tier = excluded.tier, status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
    extra_client_slots = excluded.extra_client_slots, current_period_end = excluded.current_period_end;
  delete from public.pending_entitlements where email = lower(new.email);
  return new;
exception when others then
  -- Nunca impedir un registro por esto: en el peor caso el plan se aplica en el siguiente
  -- evento de Stripe (renovación), que ya encuentra al usuario por su correo.
  raise warning 'claim_pending_entitlement: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_claim_plan on auth.users;
create trigger on_auth_user_claim_plan
  after insert on auth.users
  for each row execute function public.claim_pending_entitlement();
