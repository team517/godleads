-- ── Realtime onboarding progress ──
-- Let the client's public portal (/o/:slug) update the moment the owner changes a
-- phase. The client subscribes to postgres_changes on their OWN profile row; RLS
-- ("Users can read own profile") ensures each client only receives their own row.
-- REPLICA IDENTITY FULL makes the user_id filter reliable on UPDATE events.

alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
