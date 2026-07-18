-- Phase 3 backend for the automated client reports.
--
-- 1) report_bundle_admin(user_id, days, chart_days): the SAME metrics the browser
--    gathers, but for an EXPLICIT user_id (the client), callable ONLY by the service
--    role. The frontend RPCs use auth.uid() which is NULL under the service role, so
--    the scheduled send-report needs this p_user_id variant. Locked down: revoked from
--    anon/authenticated so a normal user can never read another user's data with it.
--
-- 2) client_reports: a log of every generated report (for the agency owner to review).
--
-- 3) client-reports storage bucket (private): where the generated PDFs live. Read via
--    service-role signed URLs (the owner views them through the admin-users fn).

create or replace function public.report_bundle_admin(p_user_id uuid, p_days int default 2, p_chart_days int default 7)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    -- Only the client's ACTIVE campaigns (running now) — not drafts/paused/finished.
    select id, name from public.campaigns where user_id = p_user_id and status = 'active'
  ),
  se as (
    select s.campaign_id, lower(coalesce(s.to_email,'')) as email, s.status,
           s.sent_at, s.opened_at, s.replied_at, s.bounced_at, s.lead_id
    from public.sent_emails s join c on c.id = s.campaign_id
  ),
  agg as (
    select campaign_id,
      count(*) filter (where sent_at is not null or status='sent') as sent,
      count(distinct coalesce(lead_id::text, email)) filter (where sent_at is not null or status='sent') as contacted,
      count(*) filter (where opened_at is not null) as opened,
      count(*) filter (where bounced_at is not null) as bounced,
      count(distinct coalesce(lead_id::text, email)) filter (where replied_at is not null) as replied
    from se group by campaign_id
  ),
  lc as (
    select campaign_id, count(*) as total, count(*) filter (where last_sent_at is not null) as contacted_leads
    from public.campaign_leads where campaign_id in (select id from c) group by campaign_id
  ),
  pos as (
    select im.campaign_id, count(*) as n from public.inbox_messages im join c on c.id=im.campaign_id
    where im.labels @> array['Interesado']::text[] group by im.campaign_id
  ),
  seq as (
    select cs.campaign_id, count(*) as n from public.campaign_steps cs join c on c.id=cs.campaign_id group by cs.campaign_id
  ),
  win as (select (now() - make_interval(days => p_days)) as start_at),
  firsts as (
    select s.campaign_id, coalesce(s.lead_id::text, lower(s.to_email)) as who, min(s.sent_at) as first_at
    from public.sent_emails s join c on c.id=s.campaign_id where s.sent_at is not null
    group by s.campaign_id, coalesce(s.lead_id::text, lower(s.to_email))
  ),
  newc as (select f.campaign_id, count(*) as n from firsts f, win where f.first_at >= win.start_at group by f.campaign_id),
  sentw as (select s.campaign_id, count(*) as n from public.sent_emails s join c on c.id=s.campaign_id, win
            where s.sent_at is not null and s.sent_at >= win.start_at group by s.campaign_id),
  repw as (select m.campaign_id, count(distinct coalesce(m.lead_id::text, lower(m.from_email))) as n
           from public.inbox_messages m join c on c.id=m.campaign_id, win
           where m.is_archived = false and m.received_at >= win.start_at group by m.campaign_id),
  days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_chart_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  dailies as (
    select c.id as campaign_id, d.day,
      (select count(*) from public.sent_emails s where s.campaign_id=c.id and s.sent_at is not null
         and (s.sent_at at time zone 'Europe/Madrid')::date = d.day) as sends,
      (select count(*) from public.inbox_messages m where m.campaign_id=c.id and m.is_archived=false
         and (m.received_at at time zone 'Europe/Madrid')::date = d.day) as replies
    from c cross join days d
  ),
  daily_agg as (
    select campaign_id, json_agg(json_build_object('day', to_char(day,'YYYY-MM-DD'), 'sends', sends, 'replies', replies) order by day) as daily
    from dailies group by campaign_id
  )
  select json_build_object('campaigns', coalesce(json_agg(json_build_object(
    'id', c.id, 'name', c.name,
    'sent', coalesce(agg.sent,0),
    'contacted', greatest(coalesce(lc.contacted_leads,0), coalesce(agg.replied,0)),
    'replied', coalesce(agg.replied,0),
    'opened', coalesce(agg.opened,0),
    'bounced', coalesce(agg.bounced,0),
    'positive', coalesce(pos.n,0),
    'sequences', coalesce(seq.n,0),
    'remaining', greatest(0, coalesce(lc.total,0) - coalesce(lc.contacted_leads,0)),
    'period_sent', coalesce(sentw.n,0),
    'period_new_contacts', coalesce(newc.n,0),
    'period_replies', coalesce(repw.n,0),
    'daily', coalesce(da.daily, '[]'::json)
  ) order by greatest(coalesce(lc.contacted_leads,0), coalesce(agg.replied,0)) desc), '[]'::json)) as bundle
  from c
  left join agg on agg.campaign_id=c.id
  left join lc on lc.campaign_id=c.id
  left join pos on pos.campaign_id=c.id
  left join seq on seq.campaign_id=c.id
  left join newc on newc.campaign_id=c.id
  left join sentw on sentw.campaign_id=c.id
  left join repw on repw.campaign_id=c.id
  left join daily_agg da on da.campaign_id=c.id;
$$;

revoke all on function public.report_bundle_admin(uuid, int, int) from public, anon, authenticated;
grant execute on function public.report_bundle_admin(uuid, int, int) to service_role;

create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  period_label text,
  pdf_path text,
  sent_to text,
  sent_ok boolean not null default false,
  error text,
  totals jsonb,
  created_at timestamptz not null default now()
);
create index if not exists client_reports_user_created on public.client_reports (user_id, created_at desc);
alter table public.client_reports enable row level security;
-- No policies on purpose: only the service role (bypasses RLS) writes/reads these; the
-- agency owner views them through the admin-users edge function (signed URLs).

insert into storage.buckets (id, name, public)
values ('client-reports', 'client-reports', false)
on conflict (id) do nothing;
