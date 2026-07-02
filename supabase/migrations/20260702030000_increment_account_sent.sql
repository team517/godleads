-- Atomic per-account daily-send counter. Replaces the read-modify-write
-- `sent_today = <value read minutes ago> + 1` in the send functions, which could
-- resurrect a stale count across the daily reset (account "wakes up" near its cap
-- and sends nothing) or lose a concurrent increment.
CREATE OR REPLACE FUNCTION public.increment_account_sent(p_account_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.email_accounts
     SET sent_today = COALESCE(sent_today, 0) + 1,
         last_send_at = now()
   WHERE id = p_account_id;
$function$;

REVOKE ALL ON FUNCTION public.increment_account_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_account_sent(uuid) TO service_role;
