-- Scale the sending engine: run every minute instead of every 2 minutes.
-- The global job lock ("process-campaign-queue") still serializes ticks, so there is
-- NO overlap / double-send — this only fills the idle gap that used to sit between
-- 2-minute ticks, roughly doubling throughput (~720 → ~1400 emails/hour) up to the
-- sequential-SMTP ceiling. No change to the send path itself.
-- (Job keeps its old name "…-every-2-min"; only the schedule changes.)
do $$
declare jid int;
begin
  select jobid into jid from cron.job where jobname = 'process-campaign-queue-every-2-min';
  if jid is not null then
    perform cron.alter_job(jid, schedule := '* * * * *');
  end if;
end $$;
