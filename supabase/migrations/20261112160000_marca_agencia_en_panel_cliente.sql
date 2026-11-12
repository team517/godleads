-- Marca doble agencia × cliente (12-11-2026).
--
-- La cuenta de un cliente necesita el nombre, el logo y el color de SU agencia para enseñarlos
-- junto a los suyos (barra superior y bienvenida "Bienvenido a <agencia>"). Esta función devuelve
-- esos tres datos y nada más, sólo de la agencia de quien tiene la sesión. Si la agencia aún no ha
-- rellenado "Tu marca de agencia", se usa el nombre/logo de su perfil.
create or replace function public.my_agency_branding()
returns table(agency_name text, logo_url text, brand_color text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(trim(a.agency_name), ''), nullif(trim(p.company_name), ''), nullif(trim(p.full_name), ''), 'Tu agencia') as agency_name,
    coalesce(nullif(trim(a.logo_url), ''), nullif(trim(p.logo_url), '')) as logo_url,
    coalesce(a.brand_color, case when p.brand_color ~ '^#[0-9A-Fa-f]{6}$' then p.brand_color end) as brand_color
  from clients c
  left join agency_branding a on a.owner_user_id = c.owner_user_id
  left join profiles p on p.user_id = c.owner_user_id
  where c.login_user_id = auth.uid() and c.archived_at is null
  limit 1;
$$;
revoke all on function public.my_agency_branding() from public;
grant execute on function public.my_agency_branding() to authenticated;
