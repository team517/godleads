-- Faster Unibox (06-10-2026). The owner: "lo del Unibox, reducir el tiempo de una forma ágil".
-- Measured with support@ / hello@ / deitta (first open vs second):
--   · Choosing a campaign (campaign_inbox_feed): 1.5–2.9 s the first time. The third part walked
--     the campaign's 15,000 leads; now it goes from the user's messages to their lead.
--     Identical results in the 12 biggest campaigns (same messages); worst case 2.4 s -> 0.45 s.
--   · Campaigns tab / phone Primary (mobile_inbox_feed): 0.5–1.3 s. Each open recomputed 100
--     entries of the rule cache older than 1 h. Now: entries live 12 h and at most 25 are
--     refreshed per open (a new message is always computed on the spot; an entry is invalidated
--     when the message's lead/campaign changes — trigger trg_inbox_match_cache_invalidate).
--   · Starred (labels contains 'Importante'): 1.4 s for support@, it walked the user's 44,000
--     messages. GIN index on labels (next migration, CONCURRENTLY).
-- The sending engine is not touched.

drop function if exists public.campaign_inbox_feed(uuid, int);
create function public.campaign_inbox_feed(p_campaign uuid, p_limit int default 1000)
returns table (
  id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
  from_email text, from_name text, subject text, body_text text, received_at timestamptz,
  is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
  auto_signal text, to_emails text, cc_emails text, in_campaign boolean, campaign_hint uuid, match_why text,
  created_at timestamptz, is_warmup boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_ids uuid[];
begin
  if v_uid is null or p_campaign is null
     or not exists (select 1 from campaigns c where c.id = p_campaign and c.user_id = v_uid) then
    return;
  end if;

  create temp table if not exists _camp_feed_lane (
    id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
    from_email text, from_name text, subject text, body_text text, received_at timestamptz,
    is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
    auto_signal text, to_emails text, cc_emails text, created_at timestamptz, is_warmup boolean
  ) on commit drop;
  create temp table if not exists _camp_feed_match (mid uuid primary key, in_campaign boolean, why text) on commit drop;
  truncate _camp_feed_lane, _camp_feed_match;

  insert into _camp_feed_lane
  select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
         m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
         m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
    from inbox_messages m
   where m.user_id = v_uid
     and m.is_sent is not true
     and m.id in (
       -- linked to the campaign (idx_im_campaign)
       select x.id from inbox_messages x
        where x.campaign_id = p_campaign and x.user_id = v_uid
       union
       -- linked to a lead of the campaign (idx_inbox_messages_lead_id)
       select x.id from campaign_leads cl
         join inbox_messages x on x.lead_id = cl.lead_id
        where cl.campaign_id = p_campaign and x.user_id = v_uid
       union
       -- written from the address of a lead of the campaign. It goes from the user's non-warm-up
       -- messages (a few thousand) to their lead by email (idx_leads_user_id_email, emails are
       -- stored lowercase) and checks that the lead is in the campaign — one lookup per
       -- message (LIMIT 1), never walking the 15,000 leads of a campaign. Unlinked warm-up is
       -- left out because the client drops it anyway (isPrimaryRow).
       select x.id from inbox_messages x
        where x.user_id = v_uid and x.is_sent is not true and x.is_warmup is not true
          and (select 1 from leads l join campaign_leads cl on cl.lead_id = l.id and cl.campaign_id = p_campaign
                where l.user_id = v_uid and l.email = lower(btrim(x.from_email)) limit 1) is not null)
   order by m.received_at desc, m.id desc
   limit v_limit;

  select array_agg(f.id) into v_ids from _camp_feed_lane f;
  if v_ids is not null then
    insert into _camp_feed_match (mid, in_campaign, why)
    select x.id, x.in_campaign, x.why from public.inbox_campaign_match(v_uid, v_ids) x;
  end if;

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           coalesce(x.in_campaign, false), p_campaign, x.why,
           f.created_at, coalesce(f.is_warmup, false)
      from _camp_feed_lane f
      left join _camp_feed_match x on x.mid = f.id
     order by f.received_at desc, f.id desc;
end;
$$;

revoke all on function public.campaign_inbox_feed(uuid, int) from public, anon;
grant execute on function public.campaign_inbox_feed(uuid, int) to authenticated;



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
      where c.mid = any (p_ids) and c.user_id = p_user and c.computed_at < now() - interval '12 hours'
      order by c.computed_at
      limit 25)
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

notify pgrst, 'reload schema';
