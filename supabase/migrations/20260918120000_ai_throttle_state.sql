-- Ritmo de las llamadas al modelo, recordado ENTRE ejecuciones del cron.
--
-- Sin esto, cada tanda empezaba de cero: el ritmo normal (30 llamadas/minuto) nunca molestó, pero
-- un repaso del histórico soltó ~1.000 llamadas en pocos minutos, la API devolvió 429 y esa tanda
-- se etiquetó sólo con reglas. Una fila, leída y escrita por el propio cron.
create table if not exists public.ai_throttle_state (
  id                 int primary key,
  window_started_at  timestamptz not null default now(),
  calls_in_window    int         not null default 0,
  cooldown_until     timestamptz,
  consecutive_limits int         not null default 0,
  updated_at         timestamptz not null default now(),
  constraint ai_throttle_single_row check (id = 1)
);

-- Sólo la llave de servicio (el cron) la toca: RLS activo y sin políticas.
alter table public.ai_throttle_state enable row level security;

insert into public.ai_throttle_state (id) values (1) on conflict (id) do nothing;
