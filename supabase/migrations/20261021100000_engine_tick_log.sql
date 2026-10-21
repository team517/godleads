-- Medición de las pasadas del motor (21-10-2026): para ver en qué se va el tiempo y por qué no llega
-- al límite de los buzones. Una fila por pasada; el motor borra las de más de 2 días.
create table if not exists public.engine_tick_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  duration_ms int, attempts int, sent int, batches int, smtp_ms int, record_ms int,
  stop text, campaigns int, top_campaigns jsonb
);
create index if not exists engine_tick_log_created on public.engine_tick_log (created_at desc);
alter table public.engine_tick_log enable row level security;
revoke all on public.engine_tick_log from anon, authenticated;
