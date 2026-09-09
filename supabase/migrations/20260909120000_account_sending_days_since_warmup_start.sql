-- BUGFIX ("sent_today 8/5, 10/5"): the per-account slow-ramp counted the mailbox's ALL-TIME
-- campaign send days, so turning on slow-ramp on a mailbox that had already been sending for
-- days instantly maxed the ramp (engine_eff jumped to the 30/day cap) while the account CARD,
-- which counts days since warmup_started_at, still showed "Día 2 · 5/día". The engine then let
-- the account send up to 30 while the UI showed 5 → "8/5", "10/5", "11/5".
--
-- Fix: only count sending days ON OR AFTER warmup_started_at, so enabling slow-ramp genuinely
-- RESTARTS the warm-up from the start base and climbs one step per real send day — exactly what
-- the card shows. Idle accounts (no campaign sends since warmup_started_at) still stay frozen at
-- the start base (days = 0), preserving the earlier "freeze on idle" guarantee.
CREATE OR REPLACE FUNCTION public.account_sending_days(p_account_ids uuid[], p_tz text)
RETURNS TABLE(account_id uuid, days int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT se.account_id,
         count(DISTINCT (se.sent_at AT TIME ZONE p_tz)::date)::int AS days
  FROM sent_emails se
  JOIN email_accounts ea ON ea.id = se.account_id
  WHERE se.account_id = ANY(p_account_ids)
    AND se.status IN ('sent', 'bounced')
    AND se.sent_at IS NOT NULL
    AND se.campaign_id IS NOT NULL
    AND (se.sent_at AT TIME ZONE p_tz)::date < (now() AT TIME ZONE p_tz)::date  -- prior days only
    AND (ea.warmup_started_at IS NULL
         OR (se.sent_at AT TIME ZONE p_tz)::date >= (ea.warmup_started_at AT TIME ZONE p_tz)::date)
  GROUP BY se.account_id;
$$;
REVOKE ALL ON FUNCTION public.account_sending_days(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_sending_days(uuid[], text) TO service_role;
