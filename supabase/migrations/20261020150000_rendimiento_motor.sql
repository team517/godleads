-- Rendimiento (20-10-2026, "que la plataforma vaya rápida sin cargar la CPU"). Medido con
-- pg_stat_statements desde el 01-10: las consultas que más tiempo de base de datos gastan.

-- 1) account_sending_days (10 % del tiempo total: 106.000 llamadas, 192 ms cada una). El motor la
--    pide en CADA pasada para el warm-up y recorre todo el historial de envíos de cada buzón, pero el
--    número (días con envíos ANTES de hoy) sólo cambia al cambiar el día o si se reinicia el warm-up
--    del buzón. Se guarda por buzón y día; el resto de pasadas del día lo leen hecho. Mismo resultado.
create table if not exists public.account_sending_days_cache (
  account_id uuid not null,
  tz text not null,
  day date not null,
  warmup_started_at timestamptz,
  days int not null,
  primary key (account_id, tz)
);
alter table public.account_sending_days_cache enable row level security;
revoke all on public.account_sending_days_cache from anon, authenticated;

create or replace function public.account_sending_days(p_account_ids uuid[], p_tz text)
returns table(account_id uuid, days integer)
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare v_today date := (now() at time zone p_tz)::date;
begin
  -- Recalcula sólo los que no están hechos para hoy (o cuyo warm-up se reinició).
  insert into public.account_sending_days_cache as c (account_id, tz, day, warmup_started_at, days)
  select ea.id, p_tz, v_today, ea.warmup_started_at,
         (select count(distinct (se.sent_at at time zone p_tz)::date)::int
            from public.sent_emails se
           where se.account_id = ea.id
             and se.status in ('sent', 'bounced')
             and se.sent_at is not null
             and se.campaign_id is not null
             and (se.sent_at at time zone p_tz)::date < v_today
             and (ea.warmup_started_at is null
                  or (se.sent_at at time zone p_tz)::date >= (ea.warmup_started_at at time zone p_tz)::date))
    from public.email_accounts ea
   where ea.id = any(p_account_ids)
     and not exists (select 1 from public.account_sending_days_cache k
                      where k.account_id = ea.id and k.tz = p_tz and k.day = v_today
                        and k.warmup_started_at is not distinct from ea.warmup_started_at)
   order by ea.id
  on conflict (account_id, tz) do update
     set day = excluded.day, warmup_started_at = excluded.warmup_started_at, days = excluded.days;

  -- Como antes: sólo los buzones con algún día de envío.
  return query
    select k.account_id, k.days
      from public.account_sending_days_cache k
     where k.account_id = any(p_account_ids) and k.tz = p_tz and k.day = v_today and k.days > 0;
end;
$$;
revoke all on function public.account_sending_days(uuid[], text) from public, anon, authenticated;
grant execute on function public.account_sending_days(uuid[], text) to service_role;

-- 2) Antes de cada envío el motor mira los intentos previos de ESE email en ESE paso (5,7 %: 130.000
--    llamadas, 89 ms). Con este índice va directo a esas filas en vez de recorrer la campaña entera.
create index if not exists idx_se_campaign_step_to_email
  on public.sent_emails (campaign_id, campaign_step_id, to_email);

notify pgrst, 'reload schema';
