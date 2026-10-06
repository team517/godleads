-- Segundo repaso diario de los buzones (06-10-2026): a las 05:30 UTC (07:30 Madrid en verano,
-- 06:30 en invierno), antes del horario de envío, además del de las 18:30 UTC. Así lo que la
-- sincronización dejara atrás por la noche entra antes de que empiece la jornada.
select cron.unschedule(jobid) from cron.job where jobname = 'inbox-rescan-morning';
select cron.schedule('inbox-rescan-morning', '30 5 * * *', $$select public.request_nightly_inbox_rescan(2)$$);
