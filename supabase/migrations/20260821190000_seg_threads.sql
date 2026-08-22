create table if not exists public.seg_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  contact_email text not null,
  contact_name text,
  subject text not null default '',
  last_imported_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (owner_id, contact_email, subject)
);
create index if not exists seg_threads_owner_idx on public.seg_threads(owner_id, last_imported_at desc);
alter table public.seg_threads enable row level security;
drop policy if exists seg_threads_sel on public.seg_threads;
drop policy if exists seg_threads_ins on public.seg_threads;
drop policy if exists seg_threads_upd on public.seg_threads;
drop policy if exists seg_threads_del on public.seg_threads;
create policy seg_threads_sel on public.seg_threads for select using (owner_id = auth.uid());
create policy seg_threads_ins on public.seg_threads for insert with check (owner_id = auth.uid());
create policy seg_threads_upd on public.seg_threads for update using (owner_id = auth.uid());
create policy seg_threads_del on public.seg_threads for delete using (owner_id = auth.uid());
grant select, insert, update, delete on public.seg_threads to authenticated;
