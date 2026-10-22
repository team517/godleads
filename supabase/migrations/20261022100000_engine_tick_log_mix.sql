-- Reparto calculado por campaña en cada pasada (diagnóstico de seguimientos, 22-10-2026).
alter table public.engine_tick_log add column if not exists mix jsonb;
