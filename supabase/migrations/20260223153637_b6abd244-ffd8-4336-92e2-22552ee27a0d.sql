ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_tags text[] NOT NULL DEFAULT '{}';