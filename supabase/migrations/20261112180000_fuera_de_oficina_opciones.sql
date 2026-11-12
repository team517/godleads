-- Fuera de oficina: opciones por campaña (12-11-2026).
--  · ooo_delay_days: días de margen tras la vuelta antes de escribirle (0 = el mismo día que vuelve).
--  · ooo_no_date_days: si NO dice cuándo vuelve, días de espera desde que llegó (0 = seguir normal).
-- Por defecto 0 y 0: todo sigue exactamente como hasta ahora.
alter table public.campaigns
  add column if not exists ooo_delay_days smallint not null default 0,
  add column if not exists ooo_no_date_days smallint not null default 0;
alter table public.campaigns drop constraint if exists campaigns_ooo_delay_days_check;
alter table public.campaigns add constraint campaigns_ooo_delay_days_check check (ooo_delay_days between 0 and 7);
alter table public.campaigns drop constraint if exists campaigns_ooo_no_date_days_check;
alter table public.campaigns add constraint campaigns_ooo_no_date_days_check check (ooo_no_date_days between 0 and 30);

-- Registro: una espera sin fecha (por la opción de la campaña) se anota con source = 'espera'.
alter table public.ooo_returns drop constraint if exists ooo_returns_source_check;
alter table public.ooo_returns add constraint ooo_returns_source_check check (source is null or source in ('reglas', 'ia', 'espera'));
