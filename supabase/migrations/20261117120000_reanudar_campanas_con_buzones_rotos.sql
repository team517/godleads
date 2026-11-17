-- Reanudar las campañas pausadas solas aunque tengan algún buzón roto (17-11-2026).
--
-- Antes una campaña pausada por errores de IONOS sólo volvía si el 80 % de TODOS sus buzones estaba
-- sano y NINGUNO había fallado en 30 min. Con un solo buzón con la contraseña mala (que ya está fuera
-- de la rotación como "auth_failed") la campaña se quedaba parada para siempre: el 16 y el 17-11
-- quedaron así TIARE, publiup, coco, Idento, TECNOPREVEN y la de xavi software de support@.
--
-- Ahora: se reanuda si tiene al menos un buzón sano (conectado y sin espera) y como mucho el 20 %
-- de sus buzones CONECTADOS ha dado un error nuestro o de IONOS en los últimos 30 min. Los buzones
-- desconectados (auth_failed / error) no cuentan: el motor ya no los usa. La parte que pausa no cambia.

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
             count(*) filter (where ea.status = 'connected' and exists (
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
      and a.sanos >= 1
      and a.con_errores_recientes * 100 <= a.sanos * 20
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
