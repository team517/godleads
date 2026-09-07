-- ── Responsables de campaña ──
-- Nombres reutilizables (p. ej. "Samuel") que el usuario crea una vez y asigna a campañas.
-- Se muestran en la lista de campañas y junto al chip de campaña en el Unibox.
create table if not exists public.campaign_managers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  color text not null default '#7A5AF8',
  created_at timestamptz not null default now()
);
create unique index if not exists uq_campaign_managers_user_name
  on public.campaign_managers (user_id, lower(name));

alter table public.campaign_managers enable row level security;
drop policy if exists "campaign_managers_select_own" on public.campaign_managers;
create policy "campaign_managers_select_own" on public.campaign_managers
  for select using (auth.uid() = user_id);
drop policy if exists "campaign_managers_insert_own" on public.campaign_managers;
create policy "campaign_managers_insert_own" on public.campaign_managers
  for insert with check (auth.uid() = user_id);
drop policy if exists "campaign_managers_update_own" on public.campaign_managers;
create policy "campaign_managers_update_own" on public.campaign_managers
  for update using (auth.uid() = user_id);
drop policy if exists "campaign_managers_delete_own" on public.campaign_managers;
create policy "campaign_managers_delete_own" on public.campaign_managers
  for delete using (auth.uid() = user_id);

-- Al borrar un nombre, las campañas que lo usaban quedan sin responsable (no se rompen).
alter table public.campaigns add column if not exists manager_id uuid
  references public.campaign_managers(id) on delete set null;
