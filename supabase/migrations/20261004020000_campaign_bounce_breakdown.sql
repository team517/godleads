-- Desglose de los rebotes de cada campaña por causa, para que la columna "Rebotados" se explique:
--   policy         → el servidor del destinatario rechazó al NUESTRO (lista negra / reputación:
--                    "blocked using Spamhaus", "Access denied"): infraestructura, no la lista.
--   recipient_gone → el buzón no existe o está inactivo: calidad de la lista.
--   temporary      → rebote temporal (buzón lleno, servidor caído).
--   other          → sin clasificar.
-- El 2 de octubre de 2026 IONOS enrutó los envíos por un servidor en Spamhaus y el 42 % rebotó;
-- sin este desglose la cifra parecía un fallo de la plataforma. Respeta "Reiniciar analíticas"
-- (campaigns.analytics_reset_at) igual que campaign_metrics_v2. Un envío cuenta una vez aunque
-- hayan llegado varios avisos (la tormenta de reintentos del 2 de octubre).
create or replace function public.campaign_bounce_breakdown(p_user_id uuid)
returns table (campaign_id uuid, policy bigint, recipient_gone bigint, temporary bigint, other bigint)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select id, coalesce(analytics_reset_at, '-infinity'::timestamptz) as since
    from campaigns where user_id = p_user_id and p_user_id = auth.uid()
  ),
  b as (
    select l.campaign_id,
           coalesce(l.sent_email_id::text, l.id::text) as k,
           case when l.bounce_class in ('policy', 'recipient_gone', 'temporary') then l.bounce_class else 'other' end as cls
    from inbox_ingest_log l
    join c on c.id = l.campaign_id
    where l.user_id = p_user_id and l.kind = 'bounce'
      and coalesce(l.received_at, l.created_at) >= c.since
  ),
  d as (
    -- un envío, una causa (la primera registrada)
    select distinct on (campaign_id, k) campaign_id, k, cls from b order by campaign_id, k, cls
  )
  select d.campaign_id,
         count(*) filter (where cls = 'policy'),
         count(*) filter (where cls = 'recipient_gone'),
         count(*) filter (where cls = 'temporary'),
         count(*) filter (where cls = 'other')
  from d group by d.campaign_id;
$$;

revoke all on function public.campaign_bounce_breakdown(uuid) from public, anon;
grant execute on function public.campaign_bounce_breakdown(uuid) to authenticated;

-- El log no tenía índice por campaña: con 81.000 filas iba por el de usuario; esto lo deja directo.
create index if not exists inbox_ingest_log_campaign_kind on public.inbox_ingest_log (campaign_id, kind) where campaign_id is not null;
