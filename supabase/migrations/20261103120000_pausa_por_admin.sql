-- Pausa de una cuenta de cliente por el administrador (03-11-2026). Desde el Portal de Clientes el
-- admin (o un gestor de clientes) pausa la cuenta: todas sus campañas pasan a "Pausada por el admin"
-- (se recuerda el estado que tenían para reanudarlas), el cliente no puede reactivarlas y al entrar
-- sólo ve "Cuenta pausada por el administrador". Reanudar deshace todo.
alter table public.profiles add column if not exists paused_by_admin_at timestamptz;
alter table public.profiles add column if not exists paused_by_admin_reason text;
alter table public.campaigns add column if not exists admin_paused boolean not null default false;
alter table public.campaigns add column if not exists admin_paused_prev_status text;

-- ¿Quien llama es del equipo (admin o gestor de clientes)? El cron/servicio (sin uid) también.
create or replace function public.is_staff_caller()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null
    or exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_client_manager);
$$;
revoke all on function public.is_staff_caller() from public, anon;
grant execute on function public.is_staff_caller() to authenticated;

create or replace function public.admin_pause_account(p_user uuid, p_pause boolean, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare n int := 0;
begin
  if auth.uid() is null or not public.is_staff_caller() then
    raise exception 'Sólo el equipo puede pausar o reanudar cuentas';
  end if;
  if p_pause then
    update public.profiles set paused_by_admin_at = coalesce(paused_by_admin_at, now()), paused_by_admin_reason = p_reason where user_id = p_user;
    update public.campaigns set admin_paused = true, admin_paused_prev_status = status, status = 'paused', updated_at = now()
      where user_id = p_user and not admin_paused and status <> 'completed';
    get diagnostics n = row_count;
  else
    update public.profiles set paused_by_admin_at = null, paused_by_admin_reason = null where user_id = p_user;
    update public.campaigns set status = coalesce(admin_paused_prev_status, 'paused'), admin_paused = false, admin_paused_prev_status = null, updated_at = now()
      where user_id = p_user and admin_paused;
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('ok', true, 'paused', p_pause, 'campaigns', n);
end $$;
revoke all on function public.admin_pause_account(uuid, boolean, text) from public, anon;
grant execute on function public.admin_pause_account(uuid, boolean, text) to authenticated;

-- El cliente no puede reactivar una campaña pausada por el admin ni quitarle la marca.
create or replace function public.campaigns_admin_paused_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.is_staff_caller() then return new; end if;
  if old.admin_paused and new.status is distinct from 'paused' then
    raise exception 'Campaña pausada por el administrador: no se puede reactivar';
  end if;
  if new.admin_paused is distinct from old.admin_paused or new.admin_paused_prev_status is distinct from old.admin_paused_prev_status then
    raise exception 'Sólo el administrador puede cambiar la pausa de esta campaña';
  end if;
  return new;
end $$;
drop trigger if exists trg_campaigns_admin_paused_guard on public.campaigns;
create trigger trg_campaigns_admin_paused_guard before update on public.campaigns
  for each row execute function public.campaigns_admin_paused_guard();
