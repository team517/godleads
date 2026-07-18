-- Per-campaign numbers for a REPORTING WINDOW (last N days), for the automated client
-- reports: how many people we contacted FOR THE FIRST TIME in the window, how many
-- replies came in, and how many emails went out. auth.uid()-scoped + SECURITY DEFINER
-- so a caller only ever sees their own campaigns (the client sub-user, or the agency
-- owner running a test on their own account).
--
-- "new_contacts" = distinct leads whose FIRST-EVER send in the campaign lands inside the
-- window — i.e. people contacted for the first time this period (not follow-ups).

create or replace function public.campaign_report_period(p_days int default 7)
returns table (
  campaign_id   uuid,
  new_contacts  bigint,
  replies       bigint,
  sent          bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select id from public.campaigns where user_id = auth.uid()
  ),
  win as (
    select (now() - make_interval(days => p_days)) as start_at
  ),
  -- first send per (campaign, lead)
  firsts as (
    select s.campaign_id, coalesce(s.lead_id::text, lower(s.to_email)) as who, min(s.sent_at) as first_at
    from public.sent_emails s
    join c on c.id = s.campaign_id
    where s.sent_at is not null
    group by s.campaign_id, coalesce(s.lead_id::text, lower(s.to_email))
  ),
  newc as (
    select f.campaign_id, count(*) as n
    from firsts f, win
    where f.first_at >= win.start_at
    group by f.campaign_id
  ),
  sentw as (
    select s.campaign_id, count(*) as n
    from public.sent_emails s
    join c on c.id = s.campaign_id, win
    where s.sent_at is not null and s.sent_at >= win.start_at
    group by s.campaign_id
  ),
  repw as (
    select m.campaign_id, count(*) as n
    from public.inbox_messages m
    join c on c.id = m.campaign_id, win
    where m.is_archived = false and m.received_at >= win.start_at
    group by m.campaign_id
  )
  select c.id,
    coalesce(newc.n, 0),
    coalesce(repw.n, 0),
    coalesce(sentw.n, 0)
  from c
  left join newc  on newc.campaign_id  = c.id
  left join sentw on sentw.campaign_id = c.id
  left join repw  on repw.campaign_id  = c.id;
$$;

revoke all on function public.campaign_report_period(int) from public;
grant execute on function public.campaign_report_period(int) to authenticated;
