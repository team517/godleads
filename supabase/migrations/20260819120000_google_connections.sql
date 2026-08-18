-- Google connection store for the Automatización module (owner-only).
-- Tokens live server-side only; the frontend can read STATUS via my_google_connection()
-- (which never returns the tokens). Written exclusively by the google-oauth edge fn
-- using the service role. Isolated from the sending engine.

create table if not exists public.google_connections (
  owner_id uuid primary key,
  google_email text,
  refresh_token text,
  access_token text,
  token_expiry timestamptz,
  scope text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.google_connections enable row level security;
-- No direct client access — tokens must never reach the browser.
revoke all on public.google_connections from anon, authenticated;

-- Status-only accessor: returns whether the current owner is connected + the account
-- email, but NEVER the tokens.
create or replace function public.my_google_connection()
returns table(connected boolean, email text, connected_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select true, gc.google_email, gc.connected_at
  from public.google_connections gc
  where gc.owner_id = auth.uid()
  limit 1;
$$;
revoke all on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;
