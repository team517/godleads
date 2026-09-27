-- Modificaciones IA: organizar las cuentas de un cliente de golpe (etiquetas y slow ramp) y poder
-- deshacerlo. Sólo el service role (edge function ia-modificaciones). Nunca toca credenciales.

-- Poner / quitar etiquetas a muchas cuentas en UNA sentencia (support@ tiene ~900 buzones).
-- p_replace = true → las cuentas se quedan SOLO con p_add.
create or replace function public.ia_accounts_set_tags(p_user uuid, p_ids uuid[], p_add text[], p_remove text[], p_replace boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update email_accounts a
     set tags = coalesce((
           select array_agg(x order by x)
           from (select distinct trim(x) x
                   from unnest(case when p_replace then coalesce(p_add, '{}') else coalesce(a.tags, '{}') || coalesce(p_add, '{}') end) x
                  where trim(x) <> '' and not (trim(x) = any(coalesce(p_remove, '{}')))) y
         ), '{}'),
         updated_at = now()
   where a.user_id = p_user and a.id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Deshacer: devuelve a cada cuenta sus etiquetas y su slow ramp de antes.
-- p_snapshot = [{id, tags, warmup_enabled, warmup_increment, warmup_limit, warmup_day, warmup_started_at}, …]
create or replace function public.ia_accounts_restore(p_user uuid, p_snapshot jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update email_accounts a
     set tags = coalesce(s.tags, '{}'),
         warmup_enabled = s.warmup_enabled,
         warmup_increment = s.warmup_increment,
         warmup_limit = s.warmup_limit,
         warmup_day = s.warmup_day,
         warmup_started_at = s.warmup_started_at,
         updated_at = now()
    from jsonb_to_recordset(p_snapshot) as s(id uuid, tags text[], warmup_enabled boolean, warmup_increment int,
                                             warmup_limit int, warmup_day int, warmup_started_at timestamptz)
   where a.id = s.id and a.user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.ia_accounts_set_tags(uuid, uuid[], text[], text[], boolean) from public, anon, authenticated;
revoke all on function public.ia_accounts_restore(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ia_accounts_set_tags(uuid, uuid[], text[], text[], boolean) to service_role;
grant execute on function public.ia_accounts_restore(uuid, jsonb) to service_role;
