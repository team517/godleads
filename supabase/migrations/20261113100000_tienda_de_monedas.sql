-- Tienda de monedas (13-11-2026). Las monedas sólo pagan verificar correos (1) y personalizar con IA (2).
-- · coin_purchases: compras de packs que confirma el webhook firmado de Stripe (idempotente por sesión).
-- · spend_coins / refund_coins: cobro y devolución ATÓMICOS; sólo el servidor (service role) puede
--   llamarlas: un usuario nunca toca saldos (ni el suyo ni el de otro, ni con cantidades negativas).
create table if not exists public.coin_purchases (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  user_id           uuid references auth.users(id) on delete set null,
  email             text,
  coins             integer not null check (coins > 0),
  amount_cents      integer,
  currency          text,
  credited_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists coin_purchases_user_idx on public.coin_purchases (user_id, created_at desc);
create index if not exists coin_purchases_email_pending_idx on public.coin_purchases (lower(email)) where credited_at is null;
alter table public.coin_purchases enable row level security;
drop policy if exists "coin purchases owner read" on public.coin_purchases;
create policy "coin purchases owner read" on public.coin_purchases for select to authenticated using (auth.uid() = user_id);
revoke all on public.coin_purchases from anon, authenticated;
grant select on public.coin_purchases to authenticated;

-- Cobrar: resta sólo si llega el saldo. Devuelve el saldo nuevo, o NULL si no había bastante.
create or replace function public.spend_coins(p_user uuid, p_amount integer)
returns integer language sql volatile security definer set search_path = public as $$
  update profiles set coins = coins - p_amount
   where user_id = p_user and p_amount > 0 and coalesce(coins, 0) >= p_amount
  returning coins;
$$;
revoke all on function public.spend_coins(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_coins(uuid, integer) to service_role;

create or replace function public.refund_coins(p_user uuid, p_amount integer)
returns integer language sql volatile security definer set search_path = public as $$
  update profiles set coins = coalesce(coins, 0) + p_amount
   where user_id = p_user and p_amount > 0
  returning coins;
$$;
revoke all on function public.refund_coins(uuid, integer) from public, anon, authenticated;
grant execute on function public.refund_coins(uuid, integer) to service_role;

-- Sumar una compra (desde el webhook). Si la sesión ya estaba, no hace nada (Stripe reintenta).
create or replace function public.credit_coin_purchase(p_session text, p_user uuid, p_email text, p_coins integer, p_amount integer, p_currency text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_coins is null or p_coins <= 0 then return false; end if;
  insert into coin_purchases (stripe_session_id, user_id, email, coins, amount_cents, currency, credited_at)
  values (p_session, p_user, lower(nullif(trim(p_email), '')), p_coins, p_amount, p_currency, case when p_user is null then null else now() end)
  on conflict (stripe_session_id) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  if p_user is not null then
    update profiles set coins = coalesce(coins, 0) + p_coins where user_id = p_user;
  end if;
  return true;
end;
$$;
revoke all on function public.credit_coin_purchase(text, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.credit_coin_purchase(text, uuid, text, integer, integer, text) to service_role;

-- Compras pagadas sin cuenta enlazada (pagó con su correo antes de entrar): se suman al entrar.
create or replace function public.claim_my_coin_purchases()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_email text; v_total integer;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  with c as (
    update coin_purchases set user_id = auth.uid(), credited_at = now()
     where user_id is null and credited_at is null and lower(email) = v_email
    returning coins
  ) select coalesce(sum(coins), 0) into v_total from c;
  if v_total > 0 then update profiles set coins = coalesce(coins, 0) + v_total where user_id = auth.uid(); end if;
  return v_total;
end;
$$;
revoke all on function public.claim_my_coin_purchases() from public, anon;
grant execute on function public.claim_my_coin_purchases() to authenticated;

-- Para la interfaz: el saldo que usa la cuenta (el de su agencia si es el acceso de un cliente), si
-- no paga (equipo, cuentas especiales, clientes gestionados) y si tiene clave de IA propia
-- (personalizar con su clave es gratis). Quien cobra de verdad es siempre el servidor.
create or replace function public.my_coin_status()
returns table(coins integer, free boolean, own_ai_key boolean, payer_is_agency boolean)
language sql stable security definer set search_path = public as $$
  with yo as (
    select p.user_id, p.allowed_routes, p.is_client_manager, p.client_login_of,
           lower(u.email) as email,
           exists (select 1 from user_roles r where r.user_id = p.user_id and r.role = 'admin') as es_admin
      from profiles p join auth.users u on u.id = p.user_id
     where p.user_id = auth.uid()
  ), pagador as (
    select coalesce((select c.owner_user_id from clients c where c.id = yo.client_login_of), yo.user_id) as uid,
           yo.client_login_of is not null as de_agencia
      from yo
  )
  select
    coalesce((select pr.coins from profiles pr where pr.user_id = (select uid from pagador)), 0)::integer,
    (yo.email = any (array['hello@onepulso.blog','support@onepulso.online','equipo@onepulso.online','oliver@llueert.com','oliver@pannggostudioo.com','alex@lluert.net','rk@coldabry.com','oliver@osakaadigital.com','eric@dekano-core.es','alex@vioonyx.com'])
      or yo.es_admin or coalesce(yo.is_client_manager, false) or coalesce(array_length(yo.allowed_routes, 1), 0) > 0),
    exists (select 1 from user_ai_keys k where k.user_id = yo.user_id and coalesce(trim(k.api_key), '') <> ''),
    (select de_agencia from pagador)
  from yo;
$$;
revoke all on function public.my_coin_status() from public, anon;
grant execute on function public.my_coin_status() to authenticated;
