-- Server-side stats aggregation so the Estadísticas page + per-campaign sends chart count
-- EXACTLY, instead of `select()` which PostgREST caps at 1000 rows (that cap made the page
-- read "990 enviados" while the DB really had 15k+). All functions are SECURITY DEFINER and
-- filter by auth.uid()/the caller's own rows, so a user only ever sees their own numbers.
-- (Already created in prod on 2026-07-16 via the Management API; this file is the record.)

create or replace function public.user_email_stats()
returns json language sql security definer set search_path = public stable as $$
  with e as (
    select sent_at, opened_at, replied_at, bounced_at, status, lead_id, lower(to_email) as em
    from sent_emails where user_id = auth.uid()
  ),
  went as (select * from e where sent_at is not null or status in ('sent','bounced'))
  select json_build_object(
    'sent',    (select count(*) from went),
    'bounced', (select count(*) from e where bounced_at is not null or status='bounced'),
    'opened',  (select count(*) from e where opened_at is not null),
    'replied', (select count(distinct coalesce(lead_id::text, em)) from e where replied_at is not null),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null
                  and em not in (select em from went where em is not null))
  );
$$;
grant execute on function public.user_email_stats() to authenticated;

create or replace function public.user_daily_sends(p_days int default 14)
returns table(day date, sends bigint, replies bigint)
language sql security definer set search_path = public stable as $$
  with days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day)
  select d.day,
    (select count(*) from sent_emails s where s.user_id=auth.uid() and s.sent_at is not null
       and (s.sent_at at time zone 'Europe/Madrid')::date = d.day) as sends,
    (select count(distinct coalesce(s.lead_id::text, lower(s.to_email))) from sent_emails s
       where s.user_id=auth.uid() and s.replied_at is not null
         and (s.replied_at at time zone 'Europe/Madrid')::date = d.day) as replies
  from days d order by d.day;
$$;
grant execute on function public.user_daily_sends(int) to authenticated;

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
       and (m.received_at at time zone 'Europe/Madrid')::date = d.day) as replies
  from days d order by d.day;
$$;
grant execute on function public.campaign_daily_sends(uuid, int) to authenticated;
