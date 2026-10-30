-- Métricas precalculadas (31-10-2026). campaign_metrics_v2 tardaba 17,8 s en support@ con los envíos
-- fuera de memoria y el límite de la pantalla es 8 s: la lista de campañas salía con "—" y
-- "0 secuencias". campaign_metrics_extra (4,5 s), user_email_stats (3 s) y user_daily_sends (3,6 s)
-- iban por el mismo camino. Ahora la pantalla lee la cifra ya calculada (cached_rpc) y un cron la
-- refresca cada 5 min para quien la haya mirado en las últimas 2 h. Las funciones de siempre no cambian.
create table if not exists public.rpc_cache (
  user_id uuid not null,
  key text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.rpc_cache enable row level security;
revoke all on public.rpc_cache from anon, authenticated;

-- Calcula una clave para el usuario de la sesión (auth.uid()), con la función de siempre.
create or replace function public.rpc_cache_compute(p_key text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if p_key = 'campaign_metrics_v2' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r from public.campaign_metrics_v2(auth.uid()) x;
  elsif p_key = 'campaign_metrics_extra' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r from public.campaign_metrics_extra() x;
  elsif p_key = 'user_email_stats' then
    select to_jsonb(public.user_email_stats()) into r;
  elsif p_key ~ '^user_daily_sends:[0-9]{1,3}$' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into r
      from public.user_daily_sends(split_part(p_key, ':', 2)::int) x;
  else
    raise exception 'clave no permitida: %', p_key;
  end if;
  return coalesce(r, 'null'::jsonb);
end $$;
revoke all on function public.rpc_cache_compute(text) from public, anon, authenticated;

-- Lo que llama la pantalla. Con copia: la devuelve al instante (el cron la tiene al día).
-- Sin copia, o con p_force (p. ej. tras "Reiniciar analíticas"): la calcula ahora y la guarda.
create or replace function public.cached_rpc(p_key text, p_force boolean default false)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); hit public.rpc_cache; v jsonb;
begin
  if uid is null then raise exception 'sin sesión'; end if;
  if not (p_key in ('campaign_metrics_v2', 'campaign_metrics_extra', 'user_email_stats') or p_key ~ '^user_daily_sends:[0-9]{1,3}$') then
    raise exception 'clave no permitida: %', p_key;
  end if;
  select * into hit from public.rpc_cache where user_id = uid and key = p_key;
  if found and not p_force then
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

-- El cron: refresca lo mirado en las últimas 2 h y con más de 4 min, como mucho 50 s por pasada.
create or replace function public.rpc_cache_refresh()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; t0 timestamptz := clock_timestamp(); n int := 0;
begin
  for r in
    select user_id, key from public.rpc_cache
    where last_requested_at > now() - interval '2 hours' and computed_at < now() - interval '4 minutes'
    order by computed_at limit 200
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

select cron.unschedule('rpc-cache-refresh') where exists (select 1 from cron.job where jobname = 'rpc-cache-refresh');
select cron.schedule('rpc-cache-refresh', '*/5 * * * *', $$select public.rpc_cache_refresh()$$);
