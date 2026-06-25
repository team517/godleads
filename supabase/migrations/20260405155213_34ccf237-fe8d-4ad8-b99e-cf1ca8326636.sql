
-- 1. Remove user-specific tables from realtime publication
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'profiles') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'workflows') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflows;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'auto_reply_log') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.auto_reply_log;
  END IF;
END $$;

-- 2. Create a secure view for email_accounts that masks passwords
CREATE OR REPLACE VIEW public.email_accounts_safe AS
SELECT
  id, user_id, email, first_name, last_name,
  imap_username, imap_host, imap_port,
  smtp_username, smtp_host, smtp_port,
  status, tags, daily_limit, sent_today,
  send_start_hour, send_end_hour,
  warmup_enabled, warmup_day,
  last_health_check, created_at, updated_at,
  '••••••••' AS imap_password,
  '••••••••' AS smtp_password
FROM public.email_accounts;

-- Grant access to the view
GRANT SELECT ON public.email_accounts_safe TO authenticated;
