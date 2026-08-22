-- Saved reply templates for the Unibox composer (per user).
create table if not exists public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  body text not null default '',
  created_at timestamptz default now()
);
create index if not exists reply_templates_user_idx on public.reply_templates(user_id, created_at desc);
alter table public.reply_templates enable row level security;
drop policy if exists reply_templates_select on public.reply_templates;
drop policy if exists reply_templates_insert on public.reply_templates;
drop policy if exists reply_templates_update on public.reply_templates;
drop policy if exists reply_templates_delete on public.reply_templates;
create policy reply_templates_select on public.reply_templates for select using (user_id = auth.uid());
create policy reply_templates_insert on public.reply_templates for insert with check (user_id = auth.uid());
create policy reply_templates_update on public.reply_templates for update using (user_id = auth.uid());
create policy reply_templates_delete on public.reply_templates for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.reply_templates to authenticated;
