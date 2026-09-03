-- Incremental (UID) inbox sync state, per mailbox and per IMAP folder:
--   { "INBOX": { "v": <UIDVALIDITY>, "u": <last UID synced> }, "Spam": { ... } }
-- fetch-inbox reads [UIDVALIDITY]/[UIDNEXT] from every SELECT; if UIDNEXT hasn't moved it skips the
-- FETCH entirely (a mailbox with nothing new costs ~0.1-0.3s instead of re-downloading the last 50
-- messages), otherwise it `UID FETCH`es only the new range. This is what makes the Unibox near-
-- realtime with 1k+ mailboxes. (Also bootstrapped at runtime by fetch-inbox; idempotent here.)
alter table public.email_accounts add column if not exists imap_uid_state jsonb;
