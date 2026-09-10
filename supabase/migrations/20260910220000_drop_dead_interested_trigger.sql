-- Drop the dead "interested reply" notification trigger.
--
-- notify_on_interested_message() fired an outbound net.http_post on EVERY insert into
-- inbox_messages (the busiest table on the platform, fed by fetch-inbox), and it posted to
-- https://acruteihiwyrzovcdjty.supabase.co — a DIFFERENT, long-abandoned Supabase project —
-- with that project's anon key hardcoded in the function body. Nothing has been listening
-- there for months, so every insert paid for an HTTP call that could only fail, while the
-- committed key sat in the schema.
--
-- The live path is push-interested (cron, every 2 min) -> send-push, which supersedes it.

DROP TRIGGER IF EXISTS trg_notify_interested ON public.inbox_messages;
DROP FUNCTION IF EXISTS public.notify_on_interested_message();
