-- Reply-count fix: the Estadísticas "respuestas" / reply-rate under-counted because it only counted
-- inbox messages LINKED to a lead/campaign (lead_id/campaign_id not null). Replies from a COLLEAGUE
-- at a lead's company (same domain, different person) arrive unlinked, so real replies were dropped
-- and the reply rate read far too low (e.g. "1 respuesta / 0,1%"). Now a reply also counts when the
-- sender's DOMAIN matches one of the user's leads — matching the Unibox "campaign-relevant" rule.
-- (fetch-inbox now also links such replies by domain going forward; this makes the existing data
-- read correctly too, no backfill needed.) Applied to the live DB via SUPABASE_DB_URL.

create or replace function public.user_email_stats()
returns json language sql security definer set search_path = public stable as $$
  with e as (
    select sent_at, opened_at, bounced_at, status, lower(to_email) as em
    from sent_emails where user_id = auth.uid()
  ),
  went as (select * from e where sent_at is not null or status in ('sent','bounced'))
  select json_build_object(
    'sent',      (select count(*) from went),
    'contacted', (select count(distinct em) from went where em is not null and em <> ''),
    'bounced', (select count(*) from e where bounced_at is not null or status='bounced'),
    'opened',  (select count(*) from e where opened_at is not null),
    'replied', (select count(*) from inbox_messages m where m.user_id = auth.uid()
                  and m.is_archived = false and (
                    m.lead_id is not null or m.campaign_id is not null
                    or lower(split_part(m.from_email,'@',2)) in (
                      select distinct lower(split_part(l.email,'@',2)) from leads l
                      where l.user_id = auth.uid() and position('@' in l.email) > 0)
                  )),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null
                  and em not in (select em from went where em is not null))
  );
$$;
grant execute on function public.user_email_stats() to authenticated;

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
    select (im.received_at at time zone 'Europe/Madrid')::date as day, count(*) as n
    from inbox_messages im
    where im.user_id = auth.uid() and im.is_archived = false
      and (
        im.lead_id is not null or im.campaign_id is not null
        or lower(split_part(im.from_email,'@',2)) in (
          select distinct lower(split_part(l.email,'@',2)) from leads l
          where l.user_id = auth.uid() and position('@' in l.email) > 0)
      )
      and im.received_at >= (now() - make_interval(days => p_days + 2))
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
