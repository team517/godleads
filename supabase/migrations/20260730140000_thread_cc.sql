-- Persistent extra recipients per Unibox conversation ("Añadir persona").
-- Keyed by the conversation counterpart's email (thread_email = the lead's
-- from_email, lowercased). Once you add someone to a thread they STAY on it: the
-- list is reloaded when you reopen the conversation and every reply Cc's them, so
-- both people always remain on the same thread.
create table if not exists public.thread_cc (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  thread_email text not null,
  cc_email    text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, thread_email, cc_email)
);
alter table public.thread_cc enable row level security;
drop policy if exists "own thread_cc" on public.thread_cc;
create policy "own thread_cc" on public.thread_cc
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists thread_cc_lookup on public.thread_cc (user_id, thread_email);
