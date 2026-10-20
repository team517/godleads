-- Borrar una campaña daba "canceling statement due to statement timeout" (20-10-2026, «Automatización
-- · HORIZON», vacía). Al borrar sus pasos, la clave sent_emails.campaign_step_id (ON DELETE SET NULL)
-- no tenía índice: por cada paso se recorrían los 356.000 envíos. En calma 0,2 s; con carga, >8 s.
-- Mismo problema en otras claves sin índice (borrar un buzón recorría todo inbox_messages, etc.).
create index if not exists idx_se_campaign_step_id on public.sent_emails (campaign_step_id) where campaign_step_id is not null;
create index if not exists idx_campaign_steps_campaign_id on public.campaign_steps (campaign_id);
create index if not exists idx_inbox_messages_account_id on public.inbox_messages (account_id);
create index if not exists idx_campaign_accounts_account_id on public.campaign_accounts (account_id);
create index if not exists idx_account_reconnect_log_account_id on public.account_reconnect_log (account_id);
create index if not exists idx_personalization_jobs_campaign_id on public.personalization_jobs (campaign_id);
