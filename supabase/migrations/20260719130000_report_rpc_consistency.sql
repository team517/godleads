-- Report review fixes so the numbers inside one PDF agree with each other:
--
-- (#5) campaign_daily_sends counted ALL inbox_messages for the day, including
--      is_archived ones, while every other reply metric excludes archived. So the
--      chart bars could sum to MORE than the "respuestas en el periodo" KPI in the
--      same report. Add the is_archived = false filter.
--
-- (#6) campaign_report_period.repw counted MESSAGES, but the lifetime "Respuestas"
--      everywhere else is DISTINCT LEADS who replied. A lead who sent 3 messages in
--      the window added 3 → "+N en el periodo" could exceed the lifetime total.
--      Count distinct leads (by lead_id, falling back to from_email) instead.

create or replace function public.campaign_daily_sends(p_campaign_id uuid, p_days int default 7)
returns table(day date, sends bigint, replies bigint)
language sql security definer set search_path = public stable as $$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day)
  select d.day,
    (select count(*) from sent_emails s where s.campaign_id=p_campaign_id and s.user_id=auth.uid()
       and s.sent_at is not null and (s.sent_at at time zone 'Europe/Madrid')::date = d.day) as sends,
    (select count(*) from inbox_messages m where m.campaign_id=p_campaign_id and m.user_id=auth.uid()
       and m.is_archived = false
       and (m.received_at at time zone 'Europe/Madrid')::date = d.day) as replies
  from days d order by d.day;
$$;
grant execute on function public.campaign_daily_sends(uuid, int) to authenticated;

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
    -- distinct leads who replied in the window (matches lifetime "Respuestas")
    select m.campaign_id, count(distinct coalesce(m.lead_id::text, lower(m.from_email))) as n
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
