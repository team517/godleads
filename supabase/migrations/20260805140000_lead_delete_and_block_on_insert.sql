-- ── Delete leads by email/domain across ALL campaigns + block-on-insert ──

-- Delete every lead matching an email (exact) or a domain (…@domain) for the caller,
-- cascading through reminders / inbox / sent_emails / campaign_leads. Returns how many
-- leads were removed. SECURITY DEFINER but scoped to auth.uid()'s own leads.
create or replace function public.delete_leads_by_match(p_value text, p_is_domain boolean)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  ids uuid[];
  n integer;
begin
  if p_is_domain then
    select array_agg(id) into ids from public.leads
      where user_id = auth.uid() and lower(email) like '%@' || lower(p_value);
  else
    select array_agg(id) into ids from public.leads
      where user_id = auth.uid() and lower(email) = lower(p_value);
  end if;

  if ids is null then return 0; end if;
  n := coalesce(array_length(ids, 1), 0);

  delete from public.message_reminders where message_id in (
    select id from public.inbox_messages where lead_id = any(ids)
  );
  delete from public.inbox_messages where lead_id = any(ids);
  delete from public.sent_emails where lead_id = any(ids);
  delete from public.campaign_leads where lead_id = any(ids);
  delete from public.leads where id = any(ids);
  return n;
end;
$$;

grant execute on function public.delete_leads_by_match(text, boolean) to authenticated;

-- Any lead whose email (or its domain) is on the owner's blocklist is silently skipped
-- on INSERT — so blocked contacts never enter, no matter which upload path is used, while
-- the rest of the batch imports normally.
create or replace function public.skip_blocked_leads()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  dom text;
begin
  if new.email is null then return new; end if;
  dom := lower(split_part(new.email, '@', 2));
  if exists (
    select 1 from public.blocklist b
    where b.user_id = new.user_id
      and (
        (b.entry_type = 'email' and lower(b.value) = lower(new.email))
        or (b.entry_type = 'domain' and lower(b.value) = dom)
      )
  ) then
    return null; -- blocked → do not insert this row
  end if;
  return new;
end;
$$;

drop trigger if exists trg_skip_blocked_leads on public.leads;
create trigger trg_skip_blocked_leads
  before insert on public.leads
  for each row execute function public.skip_blocked_leads();
