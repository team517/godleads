-- Eliminate the millions of duplicate-insert errors/rollbacks in the inbox sync (they were
-- ~90% of all Postgres requests → "10% success rate"). fetch-inbox now UPSERTs with
-- ignoreDuplicates (ON CONFLICT DO NOTHING) instead of plain INSERT-and-error. That needs an
-- ON-CONFLICT-inferrable unique index — the existing one is PARTIAL (WHERE dedupe_hash IS NOT
-- NULL), which ON CONFLICT (user_id, dedupe_hash) can't infer. Every row already has a
-- dedupe_hash (0 nulls), so a FULL unique index is equivalent and works as the arbiter.
--
-- On the LIVE database run this in the SQL editor with CONCURRENTLY so it does NOT lock the
-- sync's writes while it builds:
--   create unique index concurrently if not exists inbox_messages_user_dedupe_full
--     on public.inbox_messages (user_id, dedupe_hash);
-- (The plain form below is for fresh/empty projects where locking is a non-issue.)
create unique index if not exists inbox_messages_user_dedupe_full
  on public.inbox_messages (user_id, dedupe_hash);
