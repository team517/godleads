-- ── Onboarding phase-change notifications: which account sends the client emails ──
-- Stored on the OWNER's own profile row. A SECURITY DEFINER helper lets the owner
-- set it only to an account they actually own.

alter table public.profiles
  add column if not exists onboarding_from_account_id uuid;

create or replace function public.set_onboarding_from_account(p_account_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_account_id is not null and not exists (
    select 1 from public.email_accounts where id = p_account_id and user_id = auth.uid()
  ) then
    raise exception 'account not found for user';
  end if;
  update public.profiles set onboarding_from_account_id = p_account_id where user_id = auth.uid();
end;
$$;

grant execute on function public.set_onboarding_from_account(uuid) to authenticated;
