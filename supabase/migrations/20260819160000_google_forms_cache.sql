-- Snapshot of the owner's Google Forms so the Automatización UI can list/select them even
-- when the live list function can't run. Populated server-side from the owner's Google
-- connection. Owner reads own rows. Isolated from the sending engine.

create table if not exists public.google_forms (
  owner_id uuid not null,
  form_id text not null,
  name text,
  url text,
  modified_time timestamptz,
  updated_at timestamptz default now(),
  primary key (owner_id, form_id)
);
alter table public.google_forms enable row level security;
revoke all on public.google_forms from anon;
drop policy if exists gf_owner_sel on public.google_forms;
create policy gf_owner_sel on public.google_forms for select to authenticated using (owner_id = auth.uid());
grant select on public.google_forms to authenticated;
