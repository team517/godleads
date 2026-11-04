-- Pestaña "Cuentas" de una campaña (04-11-2026): campaign_account_stats tardaba 1-3 s (picos de 5 s;
-- en punta de tarde superaba los 8 s del límite y la pestaña salía vacía: "las cuentas desaparecieron").
-- Leía las ~10.000 filas de sent_emails de la campaña de la tabla (196 B/fila) y recorría 225.000
-- entradas de campaign_leads para contar los leads por buzón. Ahora:
--   · índice de cobertura (campaign_id, account_id) + columnas contadas → recorrido sólo por índice;
--   · índice parcial de rebotes: error_message sólo se lee para los pocos rebotados;
--   · índice (campaign_id, assigned_account_id) para los leads por buzón.
-- SEOinnova Lead Generation: 1.000 ms → 160 ms. Mismo contrato y mismas cifras.
create index if not exists idx_cl_campaign_assigned_account
  on public.campaign_leads (campaign_id, assigned_account_id) where assigned_account_id is not null;
create index if not exists idx_se_campaign_account_cover
  on public.sent_emails (campaign_id, account_id) include (sent_at, status, replied_at, bounced_at, lead_id)
  where account_id is not null and campaign_id is not null;
create index if not exists idx_se_campaign_account_bounced
  on public.sent_emails (campaign_id, account_id)
  where account_id is not null and campaign_id is not null and (bounced_at is not null or status = 'bounced');

CREATE OR REPLACE FUNCTION public.campaign_account_stats(p_campaign_id uuid)
 RETURNS TABLE(account_id uuid, in_campaign_direct boolean, in_campaign_by_tag boolean, leads_assigned bigint, sent_total bigint, sent_today bigint, replied bigint, bounced bigint, campaigns_total bigint, campaigns_active bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Sólo columnas del índice idx_se_campaign_account_cover: recorrido sin tocar la tabla.
    SELECT se.account_id AS acc_id,
           count(*) FILTER (
             WHERE se.sent_at IS NOT NULL OR se.status IN ('sent', 'bounced')
           )                                                                   AS n_total,
           count(*) FILTER (
             WHERE se.sent_at >= (SELECT ds.from_ts FROM day_start ds)
           )                                                                   AS n_today,
           count(DISTINCT se.lead_id) FILTER (WHERE se.replied_at IS NOT NULL) AS n_replied
    FROM sent_emails se
    WHERE se.campaign_id = p_campaign_id
      AND se.account_id IS NOT NULL
    GROUP BY se.account_id
  ),
  bounces AS (
    -- Los rebotes van aparte (índice parcial idx_se_campaign_account_bounced): son pocos y son los
    -- únicos que necesitan leer error_message para bounce_is_lead_fault().
    SELECT se.account_id AS acc_id, count(*) AS n_bounced
    FROM sent_emails se
    WHERE se.campaign_id = p_campaign_id
      AND se.account_id IS NOT NULL
      AND (se.bounced_at IS NOT NULL OR se.status = 'bounced')
      AND public.bounce_is_lead_fault(se.error_message)
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
         coalesce(b.n_bounced, 0)::bigint,
         coalesce(sh.n_campaigns, 0)::bigint,
         coalesce(sh.n_active, 0)::bigint
  FROM acct a
  LEFT JOIN lead_counts l ON l.acc_id = a.acc_id
  LEFT JOIN sends  s  ON s.acc_id  = a.acc_id
  LEFT JOIN bounces b ON b.acc_id = a.acc_id
  LEFT JOIN shared sh ON sh.acc_id = a.acc_id
  ORDER BY a.acc_id;
$function$;
