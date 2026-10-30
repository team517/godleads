-- Zapmail (30-10-2026): relanzar la conexión si Zapmail se queda esperando, y revisar cada 5 min.
alter table public.zapmail_domains add column if not exists last_retry_at timestamptz;
select cron.alter_job((select jobid from cron.job where jobname = 'zapmail-refresh'), schedule := '*/5 * * * *');
