-- Attachments for campaign sequence steps. Stored as a JSON array of file references:
-- [{ name, path, mime, size }] where `path` is the object key in the `godtube-media`
-- Storage bucket. The sending engine (process-campaign-queue) downloads each file at send
-- time (service-role) and includes it as a multipart/mixed attachment on every email of the
-- step. RLS is unchanged — access to a step is already gated by campaign ownership.
alter table public.campaign_steps
  add column if not exists attachments jsonb not null default '[]'::jsonb;
