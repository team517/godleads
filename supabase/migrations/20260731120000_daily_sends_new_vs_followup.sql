-- Break the daily sends chart into NEW leads (first email of a sequence) vs
-- FOLLOW-UPS (later steps), so the Estadísticas graph/tooltip shows not just the
-- total "enviados" but how many were first-touch vs follow-up. A send counts as
-- "new" when its campaign_step_id is the FIRST step of its campaign (lowest
-- step_order); everything else (later steps + manual replies) is a follow-up, so
-- new_leads + followups always equals sends.
drop function if exists public.user_daily_sends(int);
create or replace function public.user_daily_sends(p_days int default 14)
returns table(day date, sends bigint, new_leads bigint, followups bigint, replies bigint)
language sql security definer set search_path = public stable as $$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  first_steps as (
    select cs.campaign_id, (array_agg(cs.id order by cs.step_order asc))[1] as first_step_id
    from campaign_steps cs
    where cs.campaign_id in (select id from campaigns where user_id = auth.uid())
    group by cs.campaign_id),
  s as (
    select (se.sent_at at time zone 'Europe/Madrid')::date as day,
      count(*) as n,
      count(*) filter (where se.campaign_step_id is not null and se.campaign_step_id = fs.first_step_id) as new_n
    from sent_emails se
    left join first_steps fs on fs.campaign_id = se.campaign_id
    where se.user_id = auth.uid() and se.sent_at is not null
      and se.sent_at >= (now() - make_interval(days => p_days + 2))
    group by 1),
  r as (
    select (received_at at time zone 'Europe/Madrid')::date as day, count(*) as n
    from inbox_messages
    where user_id = auth.uid() and is_archived = false
      and (lead_id is not null or campaign_id is not null)
      and received_at >= (now() - make_interval(days => p_days + 2))
    group by 1)
  select d.day,
    coalesce(s.n, 0) as sends,
    coalesce(s.new_n, 0) as new_leads,
    coalesce(s.n, 0) - coalesce(s.new_n, 0) as followups,
    coalesce(r.n, 0) as replies
  from days d
  left join s on s.day = d.day
  left join r on r.day = d.day
  order by d.day;
$$;
grant execute on function public.user_daily_sends(int) to authenticated;
