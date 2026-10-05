-- my_account_sending_days: sends from campaigns of a mailbox, by date (index-only scan per mailbox).
-- CONCURRENTLY: it does not block the engine's writes while it is created.
create index concurrently if not exists idx_se_account_campaign_sent
  on public.sent_emails (account_id, sent_at)
  where campaign_id is not null and sent_at is not null and status in ('sent', 'bounced');
