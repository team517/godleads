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

-- Progress is sourced from the SLUG's client (not the viewer's own account), so the
-- portal shows the right progress whether the client or the owner is looking. Requires
-- authentication (granted to authenticated only). Returns client_user_id so the client
-- can subscribe to their own row for realtime.
create or replace function public.onboarding_by_slug(p_slug text)
returns table(company_name text, logo_url text, brand_color text, onboarding_status jsonb, client_user_id uuid)
language sql stable security definer set search_path to 'public'
as $$
  select company_name, logo_url, brand_color, onboarding_status, user_id
  from public.profiles
  where lower(onboarding_slug) = lower(p_slug)
  limit 1;
$$;

grant execute on function public.onboarding_by_slug(text) to authenticated;
