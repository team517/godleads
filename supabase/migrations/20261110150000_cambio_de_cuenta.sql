-- Cambio de cuenta del equipo (10-11-2026): hello@ y equipo@ pueden entrar en la cuenta de un cliente
-- sin contraseña (función `impersonate`) y volver a la suya. Cada entrada queda registrada aquí.
-- Escribe sólo el service role (la función); lee el equipo (is_staff_caller()).
create table if not exists public.impersonation_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid not null,
  actor_email     text not null,
  target_user_id  uuid not null,
  target_email    text not null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  user_agent      text
);
create index if not exists impersonation_log_actor_idx on public.impersonation_log (actor_user_id, started_at desc);
create index if not exists impersonation_log_target_idx on public.impersonation_log (target_user_id, started_at desc);

alter table public.impersonation_log enable row level security;
revoke all on public.impersonation_log from anon, authenticated;
grant select on public.impersonation_log to authenticated;

drop policy if exists "impersonation_log staff read" on public.impersonation_log;
create policy "impersonation_log staff read" on public.impersonation_log
  for select to authenticated using (public.is_staff_caller());
