-- Reenvío automático de respuestas manuales que rebotan por la IP de salida (06-10-2026).
-- send-email guarda aquí lo que se pidió enviar (cuerpo, firma, cita, hilo, adjuntos pequeños) de
-- cada respuesta manual que sale bien. Si luego rebota por lista negra / reputación de la IP de
-- IONOS, fetch-inbox pide a send-email que la reenvíe tal cual desde el mismo buzón (máximo 3
-- envíos en total). Ya no se manda el aviso "No entregado" al móvil.
-- Sólo el service role la lee y escribe; las filas se borran a los 3 días.
create table if not exists public.reply_retries (
  sent_email_id uuid primary key references public.sent_emails(id) on delete cascade,
  user_id uuid not null,
  payload jsonb not null,
  attempt int not null default 0,
  status text not null default 'armed' check (status in ('armed', 'used')),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists idx_reply_retries_created on public.reply_retries (created_at);
alter table public.reply_retries enable row level security;
revoke all on public.reply_retries from anon, authenticated;
