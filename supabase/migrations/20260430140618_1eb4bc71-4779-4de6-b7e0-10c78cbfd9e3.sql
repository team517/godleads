ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS warmup_score integer,
  ADD COLUMN IF NOT EXISTS warmup_status_instantly integer,
  ADD COLUMN IF NOT EXISTS warmup_synced_at timestamptz;