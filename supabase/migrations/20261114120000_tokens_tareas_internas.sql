-- Tokens de un solo uso para tareas internas de solo lectura lanzadas por el equipo (14-11-2026).
-- Nadie los ve desde el navegador (RLS sin políticas); los crea el equipo por SQL y la función los gasta.
create table if not exists public.internal_task_tokens (
  token      text primary key,
  purpose    text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
alter table public.internal_task_tokens enable row level security;
revoke all on public.internal_task_tokens from anon, authenticated;
