-- Match an inbound sender to a CLIENT by their registered account/login email — a client may
-- write to support@ from a personal address (gmail…) that doesn't match their mailbox domain.
-- Service-role only (the client-service-agent uses it); never exposed to anon/authenticated.
create or replace function public.automation_client_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and u.id <> 'b94a0bdf-0120-44cd-8c7d-51126bfc2075'
  limit 1;
$$;
revoke all on function public.automation_client_by_email(text) from public, anon, authenticated;
grant execute on function public.automation_client_by_email(text) to service_role;
