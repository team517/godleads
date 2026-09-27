-- Borrar un paso desde el editor de secuencias sin descolocar a los leads.
--
-- El motor sigue a cada lead por POSICIÓN (campaign_leads.current_step = cuántos pasos lleva).
-- Borrar la fila a secas dejaba a quien ya había recibido ese correo apuntando un paso más allá
-- (se saltaba un correo). ia_step_delete ya hace el borrado bien (renumera 1..n y retrocede a
-- quien ya lo recibió), pero sólo lo puede llamar el service role; esta es la puerta para el
-- navegador: comprueba que la campaña es del usuario y delega en ia_step_delete.
--
-- Devuelve lo mismo que ia_step_delete (la fila borrada + "posicion"), o null si el paso ya no
-- existe (doble clic, otra pestaña).
create or replace function public.campaign_step_delete(p_step uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  select c.user_id into owner
    from campaign_steps s join campaigns c on c.id = s.campaign_id
   where s.id = p_step;
  if not found then return null; end if;
  if owner is distinct from auth.uid() then
    raise exception 'Este paso no es de tu campaña' using errcode = '42501';
  end if;
  return public.ia_step_delete(p_step);
end;
$$;

revoke all on function public.campaign_step_delete(uuid) from public, anon;
grant execute on function public.campaign_step_delete(uuid) to authenticated, service_role;
