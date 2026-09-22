-- Freno automático del motor: fallos recientes por throttling de IONOS (índice parcial, pequeño).
create index if not exists idx_se_failed_created on public.sent_emails (created_at) where status = 'failed';
