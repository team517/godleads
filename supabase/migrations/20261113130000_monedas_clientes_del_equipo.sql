-- Monedas (13-11-2026): los accesos de clientes creados en Clientes llevan allowed_routes, así que
-- no se pueden tratar como "clientes gestionados" (gratis). Regla:
--   · cuenta del equipo / especial / admin / gestor → ilimitada
--   · acceso de un cliente (client_login_of): ilimitado si su agencia es del equipo (hello@, equipo@…),
--     si no paga la agencia con sus monedas
--   · cliente gestionado desde el panel de admin (allowed_routes sin client_login_of) → gratis
create or replace function public.coins_unlimited_account(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select lower(u.email) = any (array['hello@onepulso.blog','support@onepulso.online','equipo@onepulso.online','oliver@llueert.com','oliver@pannggostudioo.com','alex@lluert.net','rk@coldabry.com','oliver@osakaadigital.com','eric@dekano-core.es','alex@vioonyx.com'])
        or exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
        or coalesce((select p.is_client_manager from profiles p where p.user_id = u.id), false)
      from auth.users u where u.id = p_user), false);
$$;
revoke all on function public.coins_unlimited_account(uuid) from public, anon, authenticated;
grant execute on function public.coins_unlimited_account(uuid) to service_role;

create or replace function public.my_coin_status()
returns table(coins integer, free boolean, own_ai_key boolean, payer_is_agency boolean)
language sql stable security definer set search_path = public as $$
  with yo as (
    select p.user_id, p.allowed_routes, p.client_login_of,
           (select c.owner_user_id from clients c where c.id = p.client_login_of) as agencia
      from profiles p where p.user_id = auth.uid()
  )
  select
    coalesce((select pr.coins from profiles pr where pr.user_id = coalesce(yo.agencia, yo.user_id)), 0)::integer,
    (public.coins_unlimited_account(yo.user_id)
      or (yo.client_login_of is not null and yo.agencia is not null and public.coins_unlimited_account(yo.agencia))
      or (yo.client_login_of is null and coalesce(array_length(yo.allowed_routes, 1), 0) > 0)),
    exists (select 1 from user_ai_keys k where k.user_id = yo.user_id and coalesce(trim(k.api_key), '') <> ''),
    yo.client_login_of is not null
  from yo;
$$;
revoke all on function public.my_coin_status() from public, anon;
grant execute on function public.my_coin_status() to authenticated;
