-- Plan a medida (11-11-2026): una barra de 10 niveles con sus envíos al mes, contactos y clientes.
-- El tier se guarda como 'scale' (todas las funciones de Scale abiertas) y los topes del nivel en
-- estas columnas. NULL = plan normal (Starter/Growth/Scale): manda el tier como siempre.

alter table public.user_entitlements
  add column if not exists custom_level      int,
  add column if not exists plan_emails_month int,
  add column if not exists plan_contacts     int,
  add column if not exists plan_clients      int;

alter table public.pending_entitlements
  add column if not exists custom_level      int,
  add column if not exists plan_emails_month int,
  add column if not exists plan_contacts     int,
  add column if not exists plan_clients      int;

-- El plan pendiente (pagó antes de registrarse) pasa a la cuenta con sus topes a medida.
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
     trial_end, cancel_at_period_end, billing_interval, custom_level, plan_emails_month, plan_contacts, plan_clients,
     last_event_at)
  values
    (new.id, p.tier, p.status, p.stripe_customer_id, p.stripe_subscription_id, p.extra_client_slots, p.current_period_end,
     p.trial_end, p.cancel_at_period_end, p.billing_interval, p.custom_level, p.plan_emails_month, p.plan_contacts, p.plan_clients,
     now())
  on conflict (user_id) do update set
    tier = excluded.tier, status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
    extra_client_slots = excluded.extra_client_slots, current_period_end = excluded.current_period_end,
    trial_end = excluded.trial_end, cancel_at_period_end = excluded.cancel_at_period_end,
    billing_interval = excluded.billing_interval,
    custom_level = excluded.custom_level, plan_emails_month = excluded.plan_emails_month,
    plan_contacts = excluded.plan_contacts, plan_clients = excluded.plan_clients,
    last_event_at = now();
  delete from public.pending_entitlements where email = lower(new.email);
  return new;
exception when others then
  raise warning 'claim_pending_entitlement: %', sqlerrm;
  return new;
end;
$$;

-- Clientes que puede crear: con plan a medida, los de su nivel; si no, los del tier (como antes).
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
      coalesce(
        (select e.plan_clients from user_entitlements e
          where e.user_id = p_user_id and e.plan_clients is not null and e.tier <> 'free'),
        case coalesce((select e.tier from user_entitlements e where e.user_id = p_user_id), 'free')
          when 'scale'  then 10
          when 'growth' then 5
          else 0
        end
      )
      + coalesce((select e.extra_client_slots from user_entitlements e where e.user_id = p_user_id), 0)
  end;
$$;

revoke all on function public.client_slots_for(uuid) from public;
grant execute on function public.client_slots_for(uuid) to authenticated, service_role;
