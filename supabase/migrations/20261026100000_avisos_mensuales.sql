-- Avisos mensuales por correo (26-10-2026). Cada fila es un correo que sale un día fijo de cada mes
-- desde un buzón de la agencia. El primero: el 24 de cada mes, desde support@, a team@, "en 2 días
-- se renueva la mensualidad de Horyzon". La función monthly-reminders lo mira cada mañana.
create table if not exists public.monthly_email_reminders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day_of_month int not null check (day_of_month between 1 and 31),
  subject text not null,
  body_html text not null,
  from_email text not null,
  to_email text not null,
  active boolean not null default true,
  last_sent_month text,            -- 'YYYY-MM' del último envío: nunca dos veces el mismo mes
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.monthly_email_reminders enable row level security;
revoke all on public.monthly_email_reminders from anon, authenticated;

insert into public.monthly_email_reminders (name, day_of_month, subject, body_html, from_email, to_email)
select 'Renovación Horyzon', 24,
  'Recordatorio: en 2 días se renueva la mensualidad de Horyzon',
  '<p>Hola,</p><p>Te recuerdo que <b>en 2 días (el día 26) se renueva la mensualidad de Horyzon</b>.</p><p>Un saludo,<br>OnePulso</p>',
  'support@onepulso.online', 'team@onepulso.online'
where not exists (select 1 from public.monthly_email_reminders where name = 'Renovación Horyzon');

-- Cada día a las 07:00 y 08:00 UTC; la función sólo envía a partir de las 9:00 de Madrid (en
-- verano sale a las 9:00, en invierno a las 9:00 también, con la segunda pasada) y una vez al mes.
-- La clave del cron se copia del de daily-digest para no escribirla en ningún archivo.
select cron.unschedule('monthly-reminders') where exists (select 1 from cron.job where jobname = 'monthly-reminders');
select cron.schedule('monthly-reminders', '0 7,8 * * *',
  (select replace(command, '/functions/v1/daily-digest', '/functions/v1/monthly-reminders') from cron.job where jobname = 'daily-digest'));
