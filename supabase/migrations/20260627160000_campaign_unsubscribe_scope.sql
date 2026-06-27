-- Per-campaign choice of WHICH sending accounts include the unsubscribe button.
-- When include_unsubscribe is on:
--   unsubscribe_all = true  -> every sending account includes it,
--   otherwise               -> only accounts whose id is in unsubscribe_account_ids
--                              OR whose tags overlap unsubscribe_account_tags.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS unsubscribe_all boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unsubscribe_account_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unsubscribe_account_tags text[] NOT NULL DEFAULT '{}';
