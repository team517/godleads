ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS last_send_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS idx_email_accounts_last_send_at ON public.email_accounts(last_send_at);
