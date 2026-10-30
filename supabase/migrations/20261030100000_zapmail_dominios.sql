-- Zapmail (30-10-2026): dominios que se pasan de IONOS a Zapmail desde el apartado /zapmail
-- (sólo hello@ y support@). La función zapmail-domains escribe aquí; el navegador lee a través de ella.
create table if not exists public.zapmail_domains (
  domain text primary key,
  ionos_id text,
  ns_before jsonb,               -- nameservers que tenía en IONOS antes del cambio (para volver atrás)
  step text not null default 'pendiente',  -- pendiente | ns_cambiados | conectando | connected | error
  zapmail_status text,           -- estado que devuelve Zapmail (CHECKING_NS_IN_WHOIS, SUCCESS…)
  error text,
  requested_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  connected_at timestamptz
);
alter table public.zapmail_domains enable row level security;
revoke all on public.zapmail_domains from anon, authenticated;

-- Cada 10 minutos se pregunta a Zapmail por los que aún no están conectados. La clave del cron se
-- copia del de daily-digest (no se escribe en ningún archivo).
select cron.unschedule('zapmail-refresh') where exists (select 1 from cron.job where jobname = 'zapmail-refresh');
select cron.schedule('zapmail-refresh', '*/10 * * * *',
  (select replace(replace(command, '/functions/v1/daily-digest', '/functions/v1/zapmail-domains'), '"secret":', '"action":"refresh","secret":')
   from cron.job where jobname = 'daily-digest'));
