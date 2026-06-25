
DROP VIEW IF EXISTS public.email_accounts_safe;
CREATE VIEW public.email_accounts_safe
WITH (security_invoker = true)
AS
SELECT
  id, user_id, email, first_name, last_name,
  imap_username, imap_host, imap_port,
  smtp_username, smtp_host, smtp_port,
  status, tags, daily_limit, sent_today,
  send_start_hour, send_end_hour,
  warmup_enabled, warmup_day,
  last_health_check, created_at, updated_at,
  '••••••••'::text AS imap_password,
  '••••••••'::text AS smtp_password
FROM public.email_accounts;

GRANT SELECT ON public.email_accounts_safe TO authenticated;
