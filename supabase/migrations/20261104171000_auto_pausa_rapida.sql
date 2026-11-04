-- auto_pause_bouncing_campaigns (04-11-2026): tardaba 22 s de media (máx. 54 s) cada 15 min porque
-- ordenaba por coalesce(sent_at, created_at), que no puede usar el índice (campaign_id, sent_at):
-- leía y ordenaba TODOS los envíos de cada campaña activa (hasta 20.000 filas anchas por campaña).
-- Mientras corría, el resto de pantallas se arrastraban (la pestaña Cuentas se quedaba vacía por el
-- límite de 8 s). Ahora ordena por sent_at con el índice y lee sólo los últimos 300 de cada una: ~1,5 s.
-- Los envíos con status 'sent'/'bounced' sin sent_at son 522 de 523.000 (66 en 30 días): se ignoran.
create or replace function public.auto_pause_bouncing_campaigns()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in
    select c.id, c.name, w.total, w.rebotes
    from public.campaigns c
    cross join lateral (
      select count(*) total,
             count(*) filter (where s.bounced_at is not null and public.bounce_is_lead_fault(s.error_message)) rebotes
      from (
        select se.bounced_at, se.error_message
        from public.sent_emails se
        where se.campaign_id = c.id
          and se.sent_at is not null
          and se.status in ('sent','bounced')
          and se.sent_at > coalesce(c.auto_paused_at, '-infinity'::timestamptz)
        order by se.sent_at desc
        limit 300
      ) s
    ) w
    where c.status = 'active'
      and w.total >= 150 and w.rebotes >= 20 and w.rebotes * 100 >= w.total * 8
  loop
    update public.campaigns set status = 'paused', auto_paused_at = now(),
      auto_paused_reason = format('Pausada automáticamente: %s de sus últimos %s envíos rebotaron por dirección inexistente (%s %%). Verifica la lista antes de reactivarla.',
        r.rebotes, r.total, round(100.0 * r.rebotes / r.total, 1))
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.auto_pause_bouncing_campaigns() from public, anon, authenticated;
