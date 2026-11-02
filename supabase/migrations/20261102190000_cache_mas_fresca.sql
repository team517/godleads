-- Caché de métricas más fresca (02-11-2026): sólo se refrescaba lo mirado en las últimas 2 h, así
-- que quien volvía por la tarde veía la cifra de la mañana (gráfica de support@: 2.260 de las 14:25
-- a las 18:35, con 3.062 reales). Ahora: lo mirado en 2 h cada 5 min; lo mirado en 3 días cada 30
-- min; y una copia de más de 6 h se recalcula al pedirla.
create or replace function public.rpc_cache_refresh()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; t0 timestamptz := clock_timestamp(); n int := 0;
begin
  for r in
    select user_id, key from public.rpc_cache
    where (last_requested_at > now() - interval '2 hours' and computed_at < now() - interval '4 minutes')
       or (last_requested_at > now() - interval '3 days' and computed_at < now() - interval '30 minutes')
    order by (last_requested_at > now() - interval '2 hours') desc, computed_at
    limit 200
  loop
    exit when clock_timestamp() - t0 > interval '50 seconds';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
      update public.rpc_cache set payload = public.rpc_cache_compute(r.key), computed_at = clock_timestamp()
      where user_id = r.user_id and key = r.key;
      n := n + 1;
    exception when others then
      raise warning 'rpc_cache_refresh % %: %', r.user_id, r.key, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.rpc_cache_refresh() from public, anon, authenticated;

create or replace function public.cached_rpc(p_key text, p_force boolean default false)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); hit public.rpc_cache; v jsonb;
begin
  if uid is null then raise exception 'sin sesión'; end if;
  if not (p_key in ('campaign_metrics_v2', 'campaign_metrics_extra', 'user_email_stats') or p_key ~ '^user_daily_sends:[0-9]{1,3}$') then
    raise exception 'clave no permitida: %', p_key;
  end if;
  select * into hit from public.rpc_cache where user_id = uid and key = p_key;
  if found and not p_force and hit.computed_at > now() - interval '6 hours' then
    if hit.last_requested_at < now() - interval '1 minute' then
      update public.rpc_cache set last_requested_at = now() where user_id = uid and key = p_key;
    end if;
    return hit.payload;
  end if;
  v := public.rpc_cache_compute(p_key);
  insert into public.rpc_cache (user_id, key, payload, computed_at, last_requested_at)
  values (uid, p_key, v, clock_timestamp(), now())
  on conflict (user_id, key) do update set payload = excluded.payload, computed_at = excluded.computed_at, last_requested_at = excluded.last_requested_at;
  return v;
end $$;
revoke all on function public.cached_rpc(text, boolean) from public, anon;
grant execute on function public.cached_rpc(text, boolean) to authenticated;
