-- ── Received-email attachments ──────────────────────────────────────────────
-- The attachment BINARY lives in Storage (bucket 'inbox-attachments'); the
-- inbox_messages row only carries lightweight metadata, so we never bloat the
-- message JSON (avoids the monolithic-blob churn that caused RAM/disk trouble).
--
-- attachments shape: [{ "name": "...", "mime": "...", "size": 1234, "path": "<uid>/<msg>/<file>" }]

alter table public.inbox_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Private bucket for received attachments (binaries).
insert into storage.buckets (id, name, public)
values ('inbox-attachments', 'inbox-attachments', false)
on conflict (id) do nothing;

-- A user may READ only their own attachments. Objects are stored under a
-- top-level folder equal to the owner's user id: "<user_id>/<msg>/<filename>".
-- (Uploads are done by the sync with the service role, which bypasses RLS.)
drop policy if exists "inbox attachments: owner can read" on storage.objects;
create policy "inbox attachments: owner can read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'inbox-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
