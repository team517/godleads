-- user_email_stats (Dashboard): the user's sends with the columns it counts, without reading the
-- table (index-only scan). Before: 15,000 heap pages for support@ (~2 s cold).
create index concurrently if not exists idx_se_user_stats
  on public.sent_emails (user_id) include (sent_at, status, bounced_at, opened_at, to_email);
