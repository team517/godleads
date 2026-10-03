-- Estado de cada contacto en la Unibox (app del móvil): Lead, Interested, Meeting booked,
-- Meeting completed, Closed, Out of office, Wrong person, Not Interested.
--
-- Sin fila, la app deduce el estado de las etiquetas que ya pone el clasificador
-- (Interesado → Interested, Fuera / Auto → Out of office…). Una fila aquí es el estado que el
-- usuario eligió a mano y manda sobre lo deducido. Va por contacto (email), no por mensaje,
-- como en Instantly: el contacto está en "Meeting booked" aunque escriba otra vez.
create table if not exists public.unibox_lead_status (
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  status text not null check (status in (
    'lead', 'interested', 'meeting_booked', 'meeting_completed', 'closed',
    'out_of_office', 'wrong_person', 'not_interested'
  )),
  updated_at timestamptz not null default now(),
  primary key (user_id, email)
);

alter table public.unibox_lead_status enable row level security;

drop policy if exists "unibox_lead_status_select_own" on public.unibox_lead_status;
create policy "unibox_lead_status_select_own" on public.unibox_lead_status
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "unibox_lead_status_insert_own" on public.unibox_lead_status;
create policy "unibox_lead_status_insert_own" on public.unibox_lead_status
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unibox_lead_status_update_own" on public.unibox_lead_status;
create policy "unibox_lead_status_update_own" on public.unibox_lead_status
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "unibox_lead_status_delete_own" on public.unibox_lead_status;
create policy "unibox_lead_status_delete_own" on public.unibox_lead_status
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.unibox_lead_status from anon;
grant select, insert, update, delete on public.unibox_lead_status to authenticated;
