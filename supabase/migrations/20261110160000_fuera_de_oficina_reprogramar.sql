-- Fuera de oficina → la campaña espera a que vuelva (10-11-2026, aprobado por el dueño).
-- Si un lead contesta "estoy fuera hasta el 21 de octubre", no se le envía nada hasta ese día y ese
-- mismo día recibe el siguiente correo de la secuencia (campaign_leads.next_attempt_at, que el motor
-- y la RPC campaign_due_followups ya respetan). La interpretación vive en
-- supabase/functions/_shared/ooo-return.ts y la decisión en _shared/ooo-reschedule.ts; la aplica
-- push-interested al etiquetar cada fuera de oficina.

-- Opción por campaña, activada por defecto.
alter table public.campaigns add column if not exists ooo_reschedule boolean not null default true;

-- Registro: una fila por fuera de oficina recibido (idempotencia y lo que se ve en la campaña).
create table if not exists public.ooo_returns (
  id               uuid primary key default gen_random_uuid(),
  inbox_message_id uuid not null unique references public.inbox_messages(id) on delete cascade,
  campaign_id      uuid references public.campaigns(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete cascade,
  return_date      date,
  scheduled_for    timestamptz,
  source           text check (source in ('reglas', 'ia')),
  status           text not null default 'pendiente' check (status in
                     ('pendiente', 'programado', 'sin_fecha', 'pasado', 'secuencia_terminada', 'desactivado', 'ya_respondio', 'no_aplica')),
  snippet          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ooo_returns_campaign_idx on public.ooo_returns (campaign_id, status, scheduled_for);
create index if not exists ooo_returns_pendiente_idx on public.ooo_returns (created_at) where status = 'pendiente';

alter table public.ooo_returns enable row level security;
drop policy if exists "ooo_returns lectura" on public.ooo_returns;
create policy "ooo_returns lectura" on public.ooo_returns for select to authenticated using (
  exists (select 1 from public.campaigns c where c.id = ooo_returns.campaign_id and c.user_id = auth.uid())
  or public.is_staff_caller()
);
-- Escribe sólo el servidor (service role, que no pasa por RLS).
revoke all on public.ooo_returns from anon;
revoke insert, update, delete on public.ooo_returns from authenticated;
grant select on public.ooo_returns to authenticated;
