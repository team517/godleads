-- Index for campaign_account_stats(): it groups sent_emails by (campaign_id, account_id).
-- CONCURRENTLY → this file MUST be applied OUTSIDE a transaction (run it on its own).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sent_emails_campaign_account
  ON public.sent_emails (campaign_id, account_id)
  WHERE account_id IS NOT NULL;
