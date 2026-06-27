-- Opt-out: per-campaign toggle to include an unsubscribe link in sent emails.
-- The /unsubscribe function adds the recipient to the blocklist (global suppression),
-- which the campaign queue already respects, so they leave every list permanently.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS include_unsubscribe boolean NOT NULL DEFAULT false;
