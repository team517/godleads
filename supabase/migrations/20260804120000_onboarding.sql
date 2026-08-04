-- ── Onboarding: per-client 6-phase progress + public portal branding ──
-- Owner sets a slug (public access URL /o/<slug>) and updates phase status.
-- The client logs in with their normal credentials and sees only their own progress.

alter table public.profiles
  add column if not exists onboarding_slug text,
  add column if not exists onboarding_status jsonb not null default '[]'::jsonb;

-- Unique, case-insensitive slug (only when set).
create unique index if not exists profiles_onboarding_slug_uidx
  on public.profiles (lower(onboarding_slug))
  where onboarding_slug is not null;

-- Public, pre-login branding for the /o/:slug page (no auth needed).
create or replace function public.onboarding_public(p_slug text)
returns table(company_name text, logo_url text, brand_color text)
language sql stable security definer set search_path to 'public'
as $$
  select company_name, logo_url, brand_color
  from public.profiles
  where lower(onboarding_slug) = lower(p_slug)
  limit 1;
$$;

-- The logged-in client's OWN branding + progress.
create or replace function public.onboarding_me()
returns table(company_name text, logo_url text, brand_color text, onboarding_status jsonb)
language sql stable security definer set search_path to 'public'
as $$
  select company_name, logo_url, brand_color, onboarding_status
  from public.profiles
  where user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.onboarding_public(text) to anon, authenticated;
grant execute on function public.onboarding_me() to anon, authenticated;
