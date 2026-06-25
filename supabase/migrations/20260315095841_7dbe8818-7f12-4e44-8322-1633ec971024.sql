
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS text_only_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_email_text_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prioritize_new_leads boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain_limit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain_daily_limit integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS provider_matching boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_filter_unlikely text NOT NULL DEFAULT 'send_last',
  ADD COLUMN IF NOT EXISTS ai_filter_hostile text NOT NULL DEFAULT 'skip';
