-- Limited "client manager" permission: a user flagged profiles.is_client_manager can use
-- the Portal de Clientes (create/list/edit/delete CLIENT accounts) but NOT the full admin
-- panel (all users / Stripe / roles). The clients they create are visible to every admin
-- and every manager because the client list is global. (Applied in prod 2026-07-17.)

alter table public.profiles
  add column if not exists is_client_manager boolean not null default false;

-- Grant it to support@onepulso.info and give it the /admin/clients route so it can navigate
-- to the portal (its allowed_routes otherwise restrict it).
update public.profiles p
set is_client_manager = true,
    allowed_routes = case
      when p.allowed_routes is null then array['/admin/clients']
      when '/admin/clients' = any(p.allowed_routes) then p.allowed_routes
      else array_append(p.allowed_routes, '/admin/clients')
    end
from auth.users u
where u.id = p.user_id and u.email = 'support@onepulso.info';
