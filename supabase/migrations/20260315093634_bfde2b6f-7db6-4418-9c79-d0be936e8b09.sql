
-- Add variant_index to sent_emails to track which A/B variant was used
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS variant_index integer DEFAULT 0;

-- Add ab_test_enabled to campaigns
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS ab_test_enabled boolean NOT NULL DEFAULT false;
