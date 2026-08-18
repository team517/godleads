-- Warm-up ramp fix: the per-account slow ramp must advance ONLY on days the account
-- ACTUALLY sent — never on calendar days when it had no active campaign / didn't send.
-- Otherwise an idle mailbox keeps climbing its ramp by the calendar and, the day it
-- finally gets a campaign, "wakes up" at a high daily cap → spam risk.
--
-- This returns, per account, how many DISTINCT PRIOR days (in the given timezone) each
-- account actually sent. The engine uses this as the ramp's day count instead of the
-- calendar sending-days since warmup_started_at.

CREATE OR REPLACE FUNCTION public.account_sending_days(p_account_ids uuid[], p_tz text)
RETURNS TABLE(account_id uuid, days int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT se.account_id,
         count(DISTINCT (se.sent_at AT TIME ZONE p_tz)::date)::int AS days
  FROM sent_emails se
  WHERE se.account_id = ANY(p_account_ids)
    AND se.status IN ('sent', 'bounced')
    AND se.sent_at IS NOT NULL
    AND (se.sent_at AT TIME ZONE p_tz)::date < (now() AT TIME ZONE p_tz)::date  -- prior days only
  GROUP BY se.account_id;
$$;
REVOKE ALL ON FUNCTION public.account_sending_days(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_sending_days(uuid[], text) TO service_role;
