-- Tope de 15 correos al día por buzón en TODA la plataforma (17-10-2026, decisión del dueño).
-- Antes 30 (motor) y límites guardados de 18/30/50. Lo que ya está POR DEBAJO de 15 (12, 0) y la
-- rampa de warm-up o el slow ramp de campaña se respetan: el motor usa siempre el MENOR.
create table if not exists public.backup_email_accounts_limits_20261017 as
  select id, daily_limit, warmup_limit from public.email_accounts
  where daily_limit > 15 or warmup_limit > 15;
update public.email_accounts set daily_limit = 15 where daily_limit > 15;
update public.email_accounts set warmup_limit = 15 where warmup_limit > 15;
alter table public.email_accounts alter column daily_limit set default 15;
