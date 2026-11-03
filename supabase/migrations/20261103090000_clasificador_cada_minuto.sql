-- Avisos al móvil más rápidos (03-11-2026): el clasificador pasa cada minuto (antes cada 2) y además
-- lo lanza fetch-inbox en cuanto trae correo nuevo. Medido antes: aviso a los 4 min de media (p90 7).
select cron.alter_job((select jobid from cron.job where jobname = 'push-interested-2min'), schedule := '* * * * *');
