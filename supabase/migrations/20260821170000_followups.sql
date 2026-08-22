-- Seguimiento: scheduled follow-ups the owner programs from the calendar. A cron sends the due
-- ones from team@ (threaded to the conversation) and marks them sent.
create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  account_id uuid,                    -- sending mailbox (team@)
  contact_email text not null,
  contact_name text,
  subject text,
  body text not null default '',
  scheduled_at timestamptz not null,
  status text not null default 'scheduled',   -- scheduled | sent | canceled | error
  in_reply_to text,
  references_hdr text,
  sent_at timestamptz,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists follow_ups_owner_idx on public.follow_ups(owner_id, scheduled_at);
create index if not exists follow_ups_due_idx on public.follow_ups(status, scheduled_at);
alter table public.follow_ups enable row level security;
drop policy if exists follow_ups_select on public.follow_ups;
drop policy if exists follow_ups_insert on public.follow_ups;
drop policy if exists follow_ups_update on public.follow_ups;
drop policy if exists follow_ups_delete on public.follow_ups;
create policy follow_ups_select on public.follow_ups for select using (owner_id = auth.uid());
create policy follow_ups_insert on public.follow_ups for insert with check (owner_id = auth.uid());
create policy follow_ups_update on public.follow_ups for update using (owner_id = auth.uid());
create policy follow_ups_delete on public.follow_ups for delete using (owner_id = auth.uid());
grant select, insert, update, delete on public.follow_ups to authenticated;
