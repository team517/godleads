-- Performance (05-10-2026). The owner asked: "que todo cargue rápido… que la app móvil no dé error al abrirla".
-- Measured with the biggest account (support@: 44,763 messages, 246,242 leads, 898 mailboxes,
-- 41,016 sends). The authenticated role has an 8 s statement_timeout, and these queries were close
-- to it, which is the error shown when opening the Unibox, the Dashboard or the phone app:
--   · mobile_inbox_feed (phone app + Campaigns tab): 2.9 s average, 7.8 s maximum, 5.6 s measured.
--     Almost all of it is the campaign rule recomputed for the same 1,000 messages on every open.
--   · user_email_stats (Dashboard): 3.9–5.9 s. It read the user's 15,000 heap pages of sends and
--     went through ALL of their messages (44,000) to count replies.
--   · my_account_sending_days (Mailboxes / campaign options): 2.9–5.2 s. It read the sends of
--     ALL clients (171,000) and only afterwards kept the user's own.
--   · get_lead_domains: 1.4–1.7 s, 56,235 rows on every Unibox open (PostgREST only returns 1,000).
-- Results are IDENTICAL: checked against the previous versions for every user with sends
-- (17 users for user_email_stats; the 12 largest, 335 rows, for my_account_sending_days).
-- The sending engine is not touched: none of these functions is read by process-campaign-queue.

-- ── 1. Campaign rule, cached per message ─────────────────────────────────────────────────────────
-- Each call computes only what is missing from the cache (new mail) and refreshes at most 100
-- entries older than 1 h (the rule depends on leads and sends that change). A message's entry is
-- discarded when its lead, campaign, sender, subject or references change. The rule itself is
-- unchanged: it is renamed to inbox_campaign_match_compute, and inbox_campaign_match becomes the
-- wrapper with the same signature, so mobile_inbox_feed, mobile_inbox_others, campaign_inbox_feed,
-- inbox_campaign_match_mine and push-interested use it without being touched.
-- IF THE RULE IS CHANGED IN THE FUTURE: edit inbox_campaign_match_compute, not the wrapper.
create table if not exists public.inbox_match_cache (
  mid uuid primary key references public.inbox_messages(id) on delete cascade,
  user_id uuid not null,
  in_campaign boolean,
  campaign_hint uuid,
  why text,
  computed_at timestamptz not null default now()
);
create index if not exists idx_inbox_match_cache_user_age on public.inbox_match_cache (user_id, computed_at);
alter table public.inbox_match_cache enable row level security;
-- No policies: only the SECURITY DEFINER functions read and write it.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'inbox_campaign_match_compute') then
    alter function public.inbox_campaign_match(uuid, uuid[]) rename to inbox_campaign_match_compute;
  end if;
end $$;
revoke all on function public.inbox_campaign_match_compute(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.inbox_campaign_match_compute(uuid, uuid[]) to service_role;

create or replace function public.inbox_campaign_match(p_user uuid, p_ids uuid[])
returns table (id uuid, in_campaign boolean, campaign_hint uuid, why text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_todo uuid[];
begin
  if p_user is null or p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;

  select array_agg(x.mid) into v_todo from (
    select q.mid from unnest(p_ids) as q(mid)
     where not exists (select 1 from inbox_match_cache c where c.mid = q.mid)
    union
    (select c.mid from inbox_match_cache c
      where c.mid = any (p_ids) and c.user_id = p_user and c.computed_at < now() - interval '1 hour'
      order by c.computed_at
      limit 100)
  ) x;

  if v_todo is not null then
    insert into inbox_match_cache as t (mid, user_id, in_campaign, campaign_hint, why, computed_at)
    select r.id, p_user, r.in_campaign, r.campaign_hint, r.why, now()
      from public.inbox_campaign_match_compute(p_user, v_todo) r
     order by r.id
    on conflict (mid) do update
      set in_campaign = excluded.in_campaign, campaign_hint = excluded.campaign_hint,
          why = excluded.why, computed_at = excluded.computed_at;
  end if;

  return query
    select c.mid, c.in_campaign, c.campaign_hint, c.why
      from inbox_match_cache c
     where c.mid = any (p_ids) and c.user_id = p_user;
end;
$$;
revoke all on function public.inbox_campaign_match(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.inbox_campaign_match(uuid, uuid[]) to service_role;

create or replace function public.inbox_match_cache_invalidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from inbox_match_cache where mid = new.id;
  return null;
end;
$$;
drop trigger if exists trg_inbox_match_cache_invalidate on public.inbox_messages;
create trigger trg_inbox_match_cache_invalidate
  after update of lead_id, campaign_id, from_email, subject, in_reply_to, ref_chain on public.inbox_messages
  for each row
  when (old.lead_id is distinct from new.lead_id
        or old.campaign_id is distinct from new.campaign_id
        or old.from_email is distinct from new.from_email
        or old.subject is distinct from new.subject
        or old.in_reply_to is distinct from new.in_reply_to
        or old.ref_chain is distinct from new.ref_chain)
  execute function public.inbox_match_cache_invalidate();

-- ── 2. Lead domains: only the ones asked for (those of the messages on screen) ───────────────────
create or replace function public.lead_domains_in(p_domains text[])
returns table (domain text)
language sql
stable
security definer
set search_path = public
as $$
  select d.dom
    from (select distinct lower(btrim(x)) as dom from unnest(p_domains[1:3000]) as x) d
   where auth.uid() is not null
     and d.dom <> ''
     and exists (select 1 from leads l
                  where l.user_id = auth.uid()
                    and lower(split_part(l.email, '@', 2)) = d.dom);
$$;
revoke all on function public.lead_domains_in(text[]) from public, anon;
grant execute on function public.lead_domains_in(text[]) to authenticated;

-- ── 3. Dashboard: user_email_stats ──────────────────────────────────────────────────────────────
-- "replied" = linked messages (counted from the idx_im_user_linked_received index) + unlinked,
-- non-warm-up messages whose domain belongs to a lead (only those, about 1,000, are looked up).
-- Same condition as before, split in two.
CREATE OR REPLACE FUNCTION public.user_email_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'replied', (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and (m.lead_id is not null or m.campaign_id is not null))
             + (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and m.lead_id is null and m.campaign_id is null and m.is_warmup is not true
                  and exists (select 1 from leads l
                               where l.user_id = auth.uid() and position('@' in l.email) > 0
                                 and lower(split_part(l.email,'@',2)) = lower(split_part(m.from_email,'@',2)))),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null
                  and em not in (select em from went where em is not null))
  );
$function$;
grant execute on function public.user_email_stats() to authenticated;

-- ── 4. Real sending days per mailbox: starting from the user's mailboxes ────────────────────────
-- Before, it read the sends of every client and then kept the user's own. Now it goes mailbox by
-- mailbox through the partial index idx_se_account_campaign_sent (see the next migration).
CREATE OR REPLACE FUNCTION public.my_account_sending_days()
 RETURNS TABLE(account_id uuid, days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ea.id, x.days
    from email_accounts ea
    cross join lateral (
      select count(distinct (se.sent_at at time zone 'Europe/Madrid')::date)::int as days
        from sent_emails se
       where se.account_id = ea.id
         and se.campaign_id is not null and se.sent_at is not null and se.status in ('sent', 'bounced')
         and (se.sent_at at time zone 'Europe/Madrid')::date < (now() at time zone 'Europe/Madrid')::date
         and (ea.warmup_started_at is null
              or (se.sent_at at time zone 'Europe/Madrid')::date >= (ea.warmup_started_at at time zone 'Europe/Madrid')::date)
    ) x
   where ea.user_id = auth.uid() and x.days > 0;
$function$;
grant execute on function public.my_account_sending_days() to authenticated;

notify pgrst, 'reload schema';
