-- Slow-ramp guarantee: the per-account ramp must advance ONLY on days the account sent as part
-- of a CAMPAIGN (campaign_id not null) — which only happens when the account is assigned to an
-- ACTIVE campaign (drafts/paused campaigns never send). This excludes warm-up, manual Unibox
-- replies and Seguimiento follow-ups (all campaign_id null) from advancing the cold-email ramp,
-- so an account not connected to any active campaign stays frozen at its start base and only
-- starts climbing once it actually sends inside an active campaign.
CREATE OR REPLACE FUNCTION public.account_sending_days(p_account_ids uuid[], p_tz text)
RETURNS TABLE(account_id uuid, days int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT se.account_id,
         count(DISTINCT (se.sent_at AT TIME ZONE p_tz)::date)::int AS days
  FROM sent_emails se
  WHERE se.account_id = ANY(p_account_ids)
    AND se.status IN ('sent', 'bounced')
    AND se.sent_at IS NOT NULL
    AND se.campaign_id IS NOT NULL
    AND (se.sent_at AT TIME ZONE p_tz)::date < (now() AT TIME ZONE p_tz)::date  -- prior days only
  GROUP BY se.account_id;
$$;
REVOKE ALL ON FUNCTION public.account_sending_days(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_sending_days(uuid[], text) TO service_role;
