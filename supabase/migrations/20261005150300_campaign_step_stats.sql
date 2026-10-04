-- "Analítica por paso" de una campaña: la pantalla hacía DOS recuentos por paso (enviados y
-- respondidos) → 2N peticiones encadenadas en cada apertura. Una sola función agrupa por paso en una
-- pasada por el índice de la campaña. Misma regla que tenían las consultas de la pantalla:
--   enviados   = sent_at relleno O status 'sent'; tras "Reiniciar analíticas", sent_at >= la marca
--   respondidos = replied_at relleno; tras "Reiniciar", replied_at >= la marca
-- Devuelve también la fila de envíos sin paso (campaign_step_id null) por si hace falta; la pantalla
-- sigue calculando "Otros" como total − suma de pasos, igual que antes.
create or replace function public.campaign_step_stats(p_campaign_id uuid)
returns table(campaign_step_id uuid, sent bigint, replied bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with lim as (
    -- Sin fila (la campaña no es de quien llama) → no se devuelve nada.
    select analytics_reset_at as since
    from public.campaigns
    where id = p_campaign_id and user_id = auth.uid()
  )
  select s.campaign_step_id,
    count(*) filter (where case when lim.since is null then (s.sent_at is not null or s.status = 'sent') else s.sent_at >= lim.since end) as sent,
    count(*) filter (where s.replied_at is not null and (lim.since is null or s.replied_at >= lim.since)) as replied
  from public.sent_emails s
  cross join lim
  where s.campaign_id = p_campaign_id and s.user_id = auth.uid()
  group by s.campaign_step_id;
$function$;
revoke all on function public.campaign_step_stats(uuid) from public;
grant execute on function public.campaign_step_stats(uuid) to authenticated;
