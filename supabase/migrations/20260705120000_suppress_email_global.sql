-- ── Global email suppression on bounce ──────────────────────────────────────
-- When a recipient bounces (sync at send-time, or async via a mailer-daemon
-- DSN caught by the sync), suppress that address for the whole account:
--   1) add it to the blocklist  → the sending queue skips it in EVERY campaign
--   2) flag every lead row with that email as status='bounced' (across ALL lists)
--      so it's visible/filterable — WITHOUT deleting anything (reversible: just
--      remove it from the blocklist to resume).
-- This stops a dead mailbox from being emailed again and burning a client's
-- sending reputation, without destroying data.

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
  v_flagged integer := 0;
begin
  if p_user_id is null or v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return 0;
  end if;

  -- 1) Never email this address again, in any campaign of this account.
  insert into public.blocklist (user_id, entry_type, value)
  values (p_user_id, 'email', v_email)
  on conflict (user_id, entry_type, value) do nothing;

  -- 2) Flag the lead in every list as bounced (non-destructive).
  update public.leads
  set status = 'bounced'
  where user_id = p_user_id and lower(email) = v_email
    and coalesce(status, '') <> 'bounced';
  get diagnostics v_flagged = row_count;

  return v_flagged;
end;
$$;

grant execute on function public.suppress_email_global(uuid, text, text) to authenticated, service_role;
