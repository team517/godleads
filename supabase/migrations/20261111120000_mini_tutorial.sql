-- Mini tutorial (11-11-2026): a las cuentas nuevas con suscripción (plan activo o prueba con
-- tarjeta) se les ofrece UNA vez un recorrido animado por la plataforma. Aquí se guarda qué
-- contestaron, para que no vuelva a salir en ningún dispositivo:
--   tour_state = 'done'    → lo vio hasta el final (o lo cerró después de empezarlo)
--   tour_state = 'skipped' → dijo "Ahora no"
--   null                   → aún no se le ha preguntado
-- Las políticas de la tabla (leer, crear y cambiar sólo la fila propia) ya cubren estas columnas.

alter table public.user_onboarding
  add column if not exists tour_state text,
  add column if not exists tour_answered_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_tour_state_check') then
    alter table public.user_onboarding
      add constraint user_onboarding_tour_state_check check (tour_state is null or tour_state in ('done', 'skipped'));
  end if;
end $$;
