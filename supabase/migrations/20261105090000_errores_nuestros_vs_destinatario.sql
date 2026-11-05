-- Pausa automática de campañas, afinada (05-11-2026, orden del dueño): pausar SOLO cuando el problema
-- es nuestro o de IONOS (no entra el login, IONOS caído o lento, "local error in processing", límite del
-- buzón, nuestro dominio con DNS mal), NUNCA por direcciones inexistentes ni por empresas o proveedores
-- que nos bloquean (Spamhaus, 5.7.1 policy, "server busy" de mx.google.com, etc.).
-- Comprobado sobre los 4.476 fallos de los últimos 14 días: 3.455 IONOS saturado, 871 login 454,
-- 118 nuestro dominio sin MX, 22 límite del buzón, 9 timeouts → "nuestros"; 1 de Google → fuera.
create or replace function public.is_server_send_error(p_error text)
returns boolean language sql immutable set search_path to 'public' as $$
  with e as (select coalesce(p_error, '') as m)
  select
    -- 1) Lo que NO es nuestro, mire lo que mire el resto:
    not (
      -- destinatario inexistente (problema de la lista)
      m ~* 'recipient rejected.*(5\.1\.1|5\.1\.0|unknown|no such|does not exist|user unknown|not found|invalid recipient)'
      or (m ~* 'recipient rejected' and m ~* 'mailbox unavailable' and m !~* 'local error|send limit|quota')
      -- bloqueo del lado del destinatario / listas negras / proveedor del destinatario
      or m ~* 'spamhaus|blocked|blacklist|black list|5\.7\.1|policy|reputation|\mspam\M|\mlisted\M|gsmtp|mx\.google|outlook\.com|protection\.outlook|yahoo'
    )
    and (
      -- 2) Lo que SÍ es nuestro o de IONOS:
      m ~* 'auth(entication)? failed|\m(535|454)\M|\mlogin\M|\mpassword\M|credential'                       -- login
      or m ~* 'time ?out|timed out|connection (reset|refused|closed|lost)|econnreset|econnrefused|broken pipe|no greeting|\msocket\M|\mtls\M|handshake' -- conexión / lentitud
      or m ~* 'local error in processing|server busy|service not available|\m421\M|too many (connections|sessions)|resources temporarily|try again' -- IONOS saturado o caído
      or m ~* 'send limit exceeded|quota exceeded|over quota'                                                -- límite del buzón en IONOS
      or m ~* '^sender rejected'                                                                            -- nuestro buzón/dominio rechazado al enviar
    )
  from e;
$$;

-- Texto de la pausa: deja claro que es un problema nuestro o de IONOS, no de la lista.
create or replace function public.auto_pause_bouncing_campaigns()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
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
      auto_paused_reason = format('Pausada automáticamente: %s de sus últimos %s intentos de envío (última hora) fallaron por un problema nuestro o de IONOS (no entra el login, servidor caído o lento, límite del buzón). No es cosa de la lista. Se reanudará sola cuando sus buzones vuelvan a funcionar.',
        r.errores, r.intentos)
    where id = r.id;
    n := n + 1;
  end loop;

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
      and (c.auto_paused_reason like 'Pausada automáticamente:%error del servidor%' or c.auto_paused_reason like 'Pausada automáticamente:%problema nuestro o de IONOS%')
      and c.auto_paused_at < now() - interval '30 minutes'
      and a.total > 0
      and a.sanos * 100 >= a.total * 80
      and a.con_errores_recientes = 0
  loop
    update public.campaigns set status = 'active',
      auto_paused_reason = format('Reanudada sola a las %s tras una pausa por un problema nuestro o de IONOS.', to_char(now() at time zone 'Europe/Madrid', 'HH24:MI'))
    where id = r.id;
  end loop;

  update public.campaigns set auto_paused_reason = null, auto_paused_at = null
   where status = 'active' and auto_paused_reason like 'Reanudada sola%' and auto_paused_at < now() - interval '1 day';

  return n;
end $$;
revoke all on function public.auto_pause_bouncing_campaigns() from public, anon, authenticated;
