-- ── Campaign metrics, computed server-side ──────────────────────────────────
-- The campaign list used to DOWNLOAD up to 5000 sent_emails rows PER campaign
-- just to count them in the browser (Replied = distinct leads, Sender Bounced =
-- distinct failed recipients). With several campaigns that was tens of thousands
-- of rows on every page open — the main reason "las campañas cargan lento".
-- This RPC returns just the numbers for ALL of the caller's campaigns in ONE call.
--
-- Security: authenticated callers are locked to their OWN campaigns via
-- coalesce(auth.uid(), p_user_id) — passing another user's id has no effect.

create or replace function public.campaign_metrics_for_user(p_user_id uuid)
returns table (
  campaign_id    uuid,
  sent           bigint,
  contacted      bigint,
  opened         bigint,
  bounced        bigint,
  replied        bigint,
  sender_bounced bigint,
  positive       bigint,
  sequences      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    -- SECURITY: always the CALLER's own campaigns. p_user_id is ignored for
    -- access (kept only for the signature) so no one can read another user's
    -- metrics by passing a different id. Anon (auth.uid() null) → no rows.
    select id from public.campaigns
    where user_id = auth.uid()
  ),
  se as (
    select s.campaign_id,
           lower(coalesce(s.to_email, '')) as email,
           s.status, s.sent_at, s.opened_at, s.replied_at, s.bounced_at, s.lead_id
    from public.sent_emails s
    join c on c.id = s.campaign_id
  ),
  okmail as (
    select campaign_id, email,
           bool_or(sent_at is not null or status in ('sent','bounced')) as ok
    from se group by campaign_id, email
  ),
  failed as (
    select se.campaign_id, count(distinct se.email) as n
    from se
    join okmail o on o.campaign_id = se.campaign_id and o.email = se.email
    where se.status = 'failed' and o.ok = false and se.email <> ''
    group by se.campaign_id
  ),
  agg as (
    select campaign_id,
      count(*) filter (where sent_at is not null or status = 'sent')   as sent,
      -- Contacted = DISTINCT people we actually emailed (not raw send rows,
      -- which include every follow-up). This is the correct denominator for the
      -- reply rate — replied/sent counts each lead's 3-4 follow-ups as separate
      -- "chances", so it makes the % look ~3-4x lower than it really is.
      count(distinct coalesce(lead_id::text, email))
        filter (where sent_at is not null or status = 'sent')          as contacted,
      count(*) filter (where opened_at is not null)                    as opened,
      count(*) filter (where bounced_at is not null)                   as bounced,
      count(distinct coalesce(lead_id::text, email))
        filter (where replied_at is not null)                          as replied
    from se group by campaign_id
  ),
  pos as (
    select im.campaign_id, count(*) as n
    from public.inbox_messages im
    join c on c.id = im.campaign_id
    where im.labels @> array['Interesado']::text[]
    group by im.campaign_id
  ),
  seq as (
    select cs.campaign_id, count(*) as n
    from public.campaign_steps cs
    join c on c.id = cs.campaign_id
    group by cs.campaign_id
  )
  select c.id,
    coalesce(agg.sent, 0),
    coalesce(agg.contacted, 0),
    coalesce(agg.opened, 0),
    coalesce(agg.bounced, 0),
    coalesce(agg.replied, 0),
    coalesce(failed.n, 0),
    coalesce(pos.n, 0),
    coalesce(seq.n, 0)
  from c
  left join agg    on agg.campaign_id    = c.id
  left join failed on failed.campaign_id = c.id
  left join pos    on pos.campaign_id    = c.id
  left join seq    on seq.campaign_id    = c.id;
$$;

revoke all on function public.campaign_metrics_for_user(uuid) from public;
grant execute on function public.campaign_metrics_for_user(uuid) to authenticated;
