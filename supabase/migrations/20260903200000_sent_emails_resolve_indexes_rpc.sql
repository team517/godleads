-- Reply → lead/campaign resolution used to cost up to 63 s per mailbox on a first sync: fetch-inbox
-- ran one `to_email ilike '%@domain'` seq-scan per unresolved sender domain (up to 25) against
-- sent_emails (~122k rows). Two indexes + one batched RPC bring that to ~1 ms.
--
-- NOTE: applied live with CREATE INDEX CONCURRENTLY (out of band). `supabase db push` wraps each
-- migration in a transaction where CONCURRENTLY is illegal, so the plain form is used here and is a
-- no-op where the indexes already exist.
create index if not exists idx_sent_emails_acct_to_email
  on public.sent_emails (account_id, to_email);

create index if not exists idx_sent_emails_acct_to_domain
  on public.sent_emails (account_id, (lower(split_part(to_email, '@', 2))));

-- One indexed query for ALL sender domains of a sync batch: the most recent campaign send to each
-- domain → (lead_id, campaign_id). fetch-inbox uses it for colleague replies (same company,
-- different address). Generic providers (gmail, hotmail…) are excluded by the caller.
create or replace function public.resolve_sent_by_domains(p_account uuid, p_domains text[])
returns table(dom text, lead_id uuid, campaign_id uuid)
language sql stable security definer set search_path to 'public'
as $$
  select distinct on (d) d as dom, s.lead_id, s.campaign_id
  from (
    select lower(split_part(to_email, '@', 2)) as d, lead_id, campaign_id, sent_at
    from public.sent_emails
    where account_id = p_account
      and lower(split_part(to_email, '@', 2)) = any(p_domains)
      and campaign_id is not null and lead_id is not null
  ) s
  order by d, sent_at desc nulls last;
$$;

grant execute on function public.resolve_sent_by_domains(uuid, text[]) to service_role, authenticated;
