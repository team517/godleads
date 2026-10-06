-- Leads esperando su reintento (06-10-2026): sólo las filas con fecha, que son muy pocas.
-- CONCURRENTLY: no bloquea las escrituras del motor mientras se crea.
create index concurrently if not exists idx_cl_campaign_next_attempt
  on public.campaign_leads (campaign_id, next_attempt_at)
  where next_attempt_at is not null;
