-- Un mismo paso de una campaña no puede quedar ENVIADO dos veces al mismo lead (06-10-2026).
-- Red de seguridad bajo la reserva de seguimientos del motor: si dos pasadas se cruzaran, la
-- segunda fila no entra (el motor lo registra en el log). Comprobado antes de crearlo: 0 choques
-- en las 302.293 filas existentes. Las filas 'failed' (reintentos) no cuentan.
-- CONCURRENTLY: no bloquea los envíos; si apareciera un duplicado entre la comprobación y la
-- creación, el índice quedaría INVALID (se ve en pg_index) y habría que limpiar y repetir.
create unique index concurrently if not exists uq_se_campaign_lead_step_sent
  on public.sent_emails (campaign_id, lead_id, campaign_step_id)
  where status in ('sent', 'bounced')
    and campaign_id is not null and lead_id is not null and campaign_step_id is not null;
