-- Lets the owner SEE the agent's recent activity + errors in the Automatización UI
-- (client_service_log is service-role only; this returns the owner's own rows).
create or replace function public.my_service_activity()
returns table(from_email text, action text, reply text, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select l.from_email, l.action, l.reply, l.created_at
  from public.client_service_log l
  where l.owner_id = auth.uid()
  order by l.created_at desc
  limit 25;
$$;
revoke all on function public.my_service_activity() from public, anon;
grant execute on function public.my_service_activity() to authenticated;
