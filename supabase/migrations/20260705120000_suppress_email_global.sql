-- ── Global email suppression on bounce ──────────────────────────────────────
-- When a recipient bounces (sync at send-time, or async via a mailer-daemon
-- DSN caught by the sync), suppress that address for the whole account:
--   1) add it to the blocklist  → the sending queue skips it in EVERY campaign
--   2) delete every lead row with that email → removed from ALL lists at once
--      (campaign_leads cascade-delete; sent_emails/inbox_messages keep their
--       history because their lead_id FK is ON DELETE SET NULL)
-- This is what stops a dead mailbox from being emailed again and burning a
-- client's sending reputation.

create or replace function public.suppress_email_global(
  p_user_id uuid,
  p_email   text,
  p_reason  text default 'bounce'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := lower(trim(p_email));
  v_deleted integer := 0;
begin
  if p_user_id is null or v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return 0;
  end if;

  -- 1) Never email this address again, in any campaign of this account.
  insert into public.blocklist (user_id, entry_type, value)
  values (p_user_id, 'email', v_email)
  on conflict (user_id, entry_type, value) do nothing;

  -- 2) Remove the lead from every list (and, via cascade, every campaign).
  delete from public.leads
  where user_id = p_user_id and lower(email) = v_email;
  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

grant execute on function public.suppress_email_global(uuid, text, text) to authenticated, service_role;
