-- Per-account stats for ONE campaign — feeds the "Cuentas" tab of the campaign detail
-- (src/components/campaigns/CampaignEmailAccounts.tsx), a Smartlead-style Email Accounts table.
--
-- The account set of a campaign is the SAME union the sending engine uses
-- (process-campaign-queue, and health_metrics() in 20260811160000_health_alerts_toggle.sql):
--   • direct picks  → campaign_accounts(campaign_id, account_id)
--   • tag matches   → email_accounts.tags && campaigns.account_tags   (text[] overlap)
-- Difference with the engine: we return accounts in EVERY status (not only 'connected'),
-- so the UI can show a broken/pending sender in red instead of silently hiding it.
-- The in_campaign_direct / in_campaign_by_tag flags say WHY the account is in the campaign.
--
-- SECURITY: security definer (it must read campaign_accounts / sent_emails / campaign_leads
-- across the owner's rows) but it returns NOTHING unless the caller owns the campaign.

CREATE OR REPLACE FUNCTION public.campaign_account_stats(p_campaign_id uuid)
RETURNS TABLE (
  account_id          uuid,
  in_campaign_direct  boolean,
  in_campaign_by_tag  boolean,
  leads_assigned      bigint,
  sent_total          bigint,
  sent_today          bigint,
  replied             bigint,
  bounced             bigint,
  campaigns_total     bigint,
  campaigns_active    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH camp AS (
    -- Ownership gate: no row here → the function returns nothing at all.
    SELECT c.id,
           c.user_id,
           coalesce(c.account_tags, '{}'::text[])          AS account_tags,
           coalesce(c.timezone, 'Europe/Madrid')           AS tz
    FROM campaigns c
    WHERE c.id = p_campaign_id
      AND c.user_id = auth.uid()
  ),
  day_start AS (
    -- Midnight of "today" in the CAMPAIGN's timezone, as a timestamptz.
    SELECT (date_trunc('day', now() AT TIME ZONE camp.tz)) AT TIME ZONE camp.tz AS from_ts
    FROM camp
  ),
  direct AS (
    SELECT ca.account_id
    FROM campaign_accounts ca, camp
    WHERE ca.campaign_id = camp.id
  ),
  acct AS (
    -- The campaign's account set = direct picks ∪ tag overlap, over the OWNER's accounts.
    SELECT ea.id                                                   AS acc_id,
           ea.tags                                                 AS acc_tags,
           (ea.id IN (SELECT d.account_id FROM direct d))          AS is_direct,
           (coalesce(ea.tags, '{}'::text[]) && camp.account_tags)  AS is_by_tag
    FROM email_accounts ea, camp
    WHERE ea.user_id = camp.user_id
      AND (
        ea.id IN (SELECT d.account_id FROM direct d)
        OR coalesce(ea.tags, '{}'::text[]) && camp.account_tags
      )
  ),
  lead_counts AS (
    SELECT cl.assigned_account_id AS acc_id, count(*) AS n
    FROM campaign_leads cl
    WHERE cl.campaign_id = p_campaign_id
      AND cl.assigned_account_id IS NOT NULL
    GROUP BY cl.assigned_account_id
  ),
  sends AS (
    SELECT se.account_id AS acc_id,
           count(*) FILTER (
             WHERE se.sent_at IS NOT NULL OR se.status IN ('sent', 'bounced')
           )                                                                   AS n_total,
           count(*) FILTER (
             WHERE se.sent_at >= (SELECT ds.from_ts FROM day_start ds)
           )                                                                   AS n_today,
           count(DISTINCT se.lead_id) FILTER (WHERE se.replied_at IS NOT NULL) AS n_replied,
           count(*) FILTER (
             WHERE se.bounced_at IS NOT NULL OR se.status = 'bounced'
           )                                                                   AS n_bounced
    FROM sent_emails se
    WHERE se.campaign_id = p_campaign_id
      AND se.account_id IS NOT NULL
    GROUP BY se.account_id
  ),
  shared AS (
    -- Smartlead's "Shared Campaign Status": in how many of the owner's campaigns does
    -- this account send (same direct ∪ tag rule), and how many of those are active.
    SELECT a.acc_id,
           count(*)                                        AS n_campaigns,
           count(*) FILTER (WHERE c2.status = 'active')     AS n_active
    FROM acct a
    JOIN campaigns c2 ON c2.user_id = (SELECT camp.user_id FROM camp)
    WHERE c2.id IN (SELECT ca.campaign_id FROM campaign_accounts ca WHERE ca.account_id = a.acc_id)
       OR coalesce(c2.account_tags, '{}'::text[]) && coalesce(a.acc_tags, '{}'::text[])
    GROUP BY a.acc_id
  )
  SELECT a.acc_id,
         a.is_direct,
         a.is_by_tag,
         coalesce(l.n, 0)::bigint,
         coalesce(s.n_total, 0)::bigint,
         coalesce(s.n_today, 0)::bigint,
         coalesce(s.n_replied, 0)::bigint,
         coalesce(s.n_bounced, 0)::bigint,
         coalesce(sh.n_campaigns, 0)::bigint,
         coalesce(sh.n_active, 0)::bigint
  FROM acct a
  LEFT JOIN lead_counts l ON l.acc_id = a.acc_id
  LEFT JOIN sends  s  ON s.acc_id  = a.acc_id
  LEFT JOIN shared sh ON sh.acc_id = a.acc_id
  ORDER BY a.acc_id;
$fn$;

REVOKE ALL ON FUNCTION public.campaign_account_stats(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.campaign_account_stats(uuid) TO authenticated;
