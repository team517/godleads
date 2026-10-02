-- Aviso de rebotes por LISTA NEGRA, por campaña (02-10-2026).
-- Un enlace que el proveedor de correo marca hace que saque esos correos por servidores en lista
-- negra: los seguimientos con calendly.com/onepulso/30min rebotaron un 38% durante semanas sin que
-- nadie lo viera. health-monitor llama a esta función cada 5 minutos y avisa con el nombre de la
-- campaña. Se mira la fecha en que LLEGÓ el rebote (received_at), no la de anotación: un repaso
-- del histórico no dispara el aviso.
create or replace function public.health_blacklist_bounces(p_minutes integer default 90, p_min integer default 8)
returns table(campaign_id uuid, name text, n bigint)
language sql stable security definer set search_path to 'public' as $fn$
  select l.campaign_id, c.name, count(*) as n
  from public.inbox_ingest_log l
  join public.campaigns c on c.id = l.campaign_id
  where l.kind = 'bounce'
    and l.received_at > now() - make_interval(mins => greatest(p_minutes, 5))
    and (l.detail ilike '%spamhaus%' or l.detail ilike '%blocked%using%' or l.detail ilike '%listed%by%')
  group by l.campaign_id, c.name
  having count(*) >= greatest(p_min, 1)
  order by count(*) desc;
$fn$;
revoke all on function public.health_blacklist_bounces(integer, integer) from public, anon, authenticated;
grant execute on function public.health_blacklist_bounces(integer, integer) to service_role;
