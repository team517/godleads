-- Pausa automática de campañas (04-11-2026, decisión del dueño): NO se pausa por rebotes de
-- direcciones inexistentes (eso es cosa de la lista, no de la plataforma). Se pausa cuando una campaña
-- acumula MUCHOS errores técnicos de envío seguidos: login de IONOS (535/454), "local error in
-- processing", timeouts, conexión rechazada… Y se reanuda sola cuando sus buzones vuelven a estar
-- conectados y sin errores, para que un bache de IONOS a las 9:00 no deje 40 campañas paradas todo el día.
--
-- Regla (última hora, por campaña activa): ≥ 20 intentos fallidos por error del servidor y que sean
-- ≥ 60 % de los intentos de esa hora → status = 'paused', auto_paused_at, auto_paused_reason.
-- Reanudación (cada pasada del cron, cada 15 min): campaña pausada por esta regla desde hace ≥ 30 min,
-- sin marca del admin, con ≥ 80 % de sus buzones 'connected' y fuera de pausa de buzón, y sin errores
-- del servidor en esos buzones en los últimos 30 min → vuelve a 'active' (la razón queda anotada con
-- "Reanudada sola a las HH:MM" y se limpia al día siguiente).

create or replace function public.is_server_send_error(p_error text)
returns boolean language sql immutable set search_path to 'public' as $$
  select public.is_temporary_send_error(p_error)
      or coalesce(p_error, '') ~* ('\m535\M|auth(entication)? failed|login|local error in processing|server busy'
                                   || '|\m(4\.7\.0|4\.3\.0|4\.3\.2|4\.4\.1|4\.4\.2)\M|relay access denied|too many recipients');
$$;

-- Lo que ya no aplica: las campañas activas con una razón antigua "por rebotes" quedan limpias.
update public.campaigns set auto_paused_reason = null, auto_paused_at = null
 where status = 'active' and auto_paused_reason like 'Pausada automáticamente:%rebotaron%';

create or replace function public.auto_pause_bouncing_campaigns()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  -- 1) Pausar por tormenta de errores del servidor (última hora).
  for r in
    select c.id, c.name, w.intentos, w.errores
    from public.campaigns c
    cross join lateral (
      select count(*) as intentos,
             count(*) filter (where se.status = 'failed' and public.is_server_send_error(se.error_message)) as errores
      from public.sent_emails se
      where se.campaign_id = c.id
        and se.created_at > now() - interval '60 minutes'
        and se.status in ('sent', 'bounced', 'failed')
    ) w
    where c.status = 'active'
      and not c.admin_paused
      and w.errores >= 20 and w.errores * 100 >= w.intentos * 60
  loop
    update public.campaigns set status = 'paused', auto_paused_at = now(),
      auto_paused_reason = format('Pausada automáticamente: %s de sus últimos %s intentos de envío (última hora) fallaron por error del servidor de correo (login de IONOS, timeout…). Se reanudará sola cuando sus buzones vuelvan a conectar.',
        r.errores, r.intentos)
    where id = r.id;
    n := n + 1;
  end loop;

  -- 2) Reanudar las pausadas por esta regla cuando sus buzones están bien otra vez.
  for r in
    select c.id, c.name
    from public.campaigns c
    cross join lateral (
      select count(*) as total,
             count(*) filter (where ea.status = 'connected' and (ea.backoff_until is null or ea.backoff_until < now())) as sanos,
             count(*) filter (where exists (
               select 1 from public.sent_emails se
               where se.account_id = ea.id and se.created_at > now() - interval '30 minutes'
                 and se.status = 'failed' and public.is_server_send_error(se.error_message))) as con_errores_recientes
      from public.email_accounts ea
      where ea.user_id = c.user_id
        and (ea.id in (select ca.account_id from public.campaign_accounts ca where ca.campaign_id = c.id)
             or coalesce(ea.tags, '{}'::text[]) && coalesce(c.account_tags, '{}'::text[]))
    ) a
    where c.status = 'paused'
      and not c.admin_paused
      and c.auto_paused_reason like 'Pausada automáticamente:%error del servidor%'
      and c.auto_paused_at < now() - interval '30 minutes'
      and a.total > 0
      and a.sanos * 100 >= a.total * 80
      and a.con_errores_recientes = 0
  loop
    update public.campaigns set status = 'active',
      auto_paused_reason = format('Reanudada sola a las %s tras una pausa por errores del servidor de correo.', to_char(now() at time zone 'Europe/Madrid', 'HH24:MI'))
    where id = r.id;
  end loop;

  -- 3) Limpieza: la nota "Reanudada sola…" desaparece al día siguiente.
  update public.campaigns set auto_paused_reason = null, auto_paused_at = null
   where status = 'active' and auto_paused_reason like 'Reanudada sola%' and auto_paused_at < now() - interval '1 day';

  return n;
end $$;
revoke all on function public.auto_pause_bouncing_campaigns() from public, anon, authenticated;

-- El índice (campaign_id, created_at) que usa la ventana de una hora (creado CONCURRENTLY en producción).
create index if not exists idx_se_campaign_created on public.sent_emails (campaign_id, created_at) where campaign_id is not null;
-- Y (account_id, created_at) para la comprobación de "sin errores recientes en sus buzones" al reanudar.
create index if not exists idx_se_account_created on public.sent_emails (account_id, created_at) where account_id is not null;

-- ── Refresco de la caché de métricas: no recalcular lo que no ha cambiado ───────────────────────
-- rpc_cache_refresh era la mayor carga única de la base (27-46 s cada 5 min con 2 GB; 5-7 s con 8 GB).
-- Ahora una clave sólo se recalcula si el usuario tiene envíos o correos recibidos nuevos desde que se
-- calculó, o si la copia tiene más de 30 min (tope de frescura para lo que no pasa por esas dos tablas).
create or replace function public.rpc_cache_refresh()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; t0 timestamptz := clock_timestamp(); n int := 0;
begin
  for r in
    select user_id, key, computed_at from public.rpc_cache
    where (last_requested_at > now() - interval '2 hours' and computed_at < now() - interval '4 minutes')
       or (last_requested_at > now() - interval '3 days' and computed_at < now() - interval '30 minutes')
    order by (last_requested_at > now() - interval '2 hours') desc, computed_at
    limit 200
  loop
    exit when clock_timestamp() - t0 > interval '50 seconds';
    if r.computed_at > now() - interval '30 minutes'
       and not exists (select 1 from public.sent_emails se where se.user_id = r.user_id and se.sent_at > r.computed_at)
       and not exists (select 1 from public.inbox_messages m where m.user_id = r.user_id and not m.is_archived and m.created_at > r.computed_at)
    then
      -- Nada nuevo: la copia sigue valiendo (no se toca computed_at: a los 30 min se recalcula igual,
      -- por si cambió algo que no pasa por envíos ni correos recibidos, p. ej. una recategorización).
      continue;
    end if;
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
