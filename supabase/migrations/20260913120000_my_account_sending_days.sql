-- ═══════════════════════════════════════════════════════════════════════════════
-- Días de envío reales por cuenta, para que la PANTALLA no mienta sobre el warm-up
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- El motor (process-campaign-queue.getEffectiveLimit) sube el arranque lento SOLO
-- los días en que la cuenta envió DE VERDAD dentro de una campaña: usa el RPC
-- account_sending_days (service_role). La interfaz, en cambio, calculaba el "día N"
-- del warm-up por días de CALENDARIO desde warmup_started_at, así que una cuenta
-- con warm-up pero sin campaña activa mostraba el límite subiendo solo, y sumaba
-- fines de semana. Mentira visual: el motor no enviaba más, pero el número crecía.
--
-- Esta función da a la interfaz la MISMA cuenta que usa el motor, pero acotada a
-- las cuentas del propio usuario (no hace falta pasar ids ni el service role).
-- Misma lógica que account_sending_days: solo envíos de CAMPAÑA (campaign_id no
-- nulo), solo días ANTERIORES a hoy, y solo desde que empezó el warm-up.
create or replace function public.my_account_sending_days()
returns table (account_id uuid, days int)
language sql
stable
security definer
set search_path = public
as $$
  select se.account_id,
         count(distinct (se.sent_at at time zone 'Europe/Madrid')::date)::int as days
  from sent_emails se
  join email_accounts ea on ea.id = se.account_id
  where ea.user_id = auth.uid()
    and se.status in ('sent', 'bounced')
    and se.sent_at is not null
    and se.campaign_id is not null
    and (se.sent_at at time zone 'Europe/Madrid')::date < (now() at time zone 'Europe/Madrid')::date
    and (ea.warmup_started_at is null
         or (se.sent_at at time zone 'Europe/Madrid')::date >= (ea.warmup_started_at at time zone 'Europe/Madrid')::date)
  group by se.account_id;
$$;

revoke all on function public.my_account_sending_days() from public;
grant execute on function public.my_account_sending_days() to authenticated;
