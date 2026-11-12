-- Las agencias entran en las cuentas de SUS clientes sin contraseña (12-11-2026), como hace el equipo
-- con todas. Esta función sólo dice a la interfaz si enseñar la entrada "Clientes" del perfil: quien
-- decide de verdad es la función `impersonate`, que comprueba de nuevo que el cliente es suyo.
create or replace function public.can_enter_my_clients()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.client_slots_for(auth.uid()) > 0
     and exists (
       select 1 from clients c
       where c.owner_user_id = auth.uid() and c.archived_at is null and c.login_user_id is not null
     );
$$;
revoke all on function public.can_enter_my_clients() from public;
grant execute on function public.can_enter_my_clients() to authenticated;
