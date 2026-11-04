-- Revisión de salud tras pasar la instancia a 8 GB (04-11-2026). Las tablas calientes reciben miles de
-- UPDATE por hora (sent_emails: estado/respuesta/rebote; campaign_leads: last_sent_at/status;
-- email_accounts: sent_today/last_sync; inbox_messages: etiquetas). Con el autovacuum por defecto
-- (20 % de la tabla) sent_emails (523.000 filas) sólo se limpiaba cada ~100.000 filas muertas y los
-- índices de cobertura dejaban de ser "sólo índice" (Heap Fetches). Umbrales más bajos por tabla:
-- limpieza y estadísticas frescas sin esperar a acumular bloat. Sin efecto en el esquema ni en RLS.
alter table public.sent_emails     set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 2);
alter table public.campaign_leads  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 2);
alter table public.leads           set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
alter table public.inbox_messages  set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
alter table public.email_accounts  set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05, autovacuum_vacuum_threshold = 200);
alter table public.engine_tick_log set (autovacuum_vacuum_scale_factor = 0.05);
alter table public.rpc_cache       set (autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 100, autovacuum_analyze_threshold = 100);
