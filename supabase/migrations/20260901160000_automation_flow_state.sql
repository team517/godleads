-- Shared backend state for "Clientes en el flujo" (Automatización). Previously the flow clients
-- lived only in the browser's localStorage, so a flow started on one device/login never appeared
-- on another. Now stored per automation-owner (b94a0bdf) so hello@ + equipo@ see the SAME flow
-- across devices. Written exclusively by the automation-view edge fn (service role).
create table if not exists public.automation_flow_state (
  owner_id uuid primary key,
  clients jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.automation_flow_state enable row level security;
revoke all on public.automation_flow_state from anon, authenticated;
