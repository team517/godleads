-- ═══════════════════════════════════════════════════════════════════════════════
-- Consumo de correos del mes: que la cifra del plan se pueda MEDIR
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Los planes se venden por correos al mes (Growth = 180.000). Una cifra que no se
-- puede mirar es propaganda, así que esto la mide. NO bloquea envíos: el motor no
-- se toca sin una decisión explícita del propietario, porque cortar por un fallo
-- de medición sería peor que pasarse del plan.
--
-- Cuenta el mes NATURAL en la zona del usuario del negocio (Europe/Madrid), que es
-- como se factura, no las últimas 30 rodantes.
create or replace function public.my_monthly_send_usage()
returns table (enviados bigint, desde timestamptz, hasta timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from sent_emails se
      where se.user_id = auth.uid()
        and se.sent_at is not null
        and se.sent_at >= date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'),
    date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid',
    (date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month') at time zone 'Europe/Madrid';
$$;

revoke all on function public.my_monthly_send_usage() from public;
grant execute on function public.my_monthly_send_usage() to authenticated;

-- El índice que hace que esa cuenta sea barata: por usuario y fecha de envío.
create index if not exists sent_emails_user_sent_at_idx
  on public.sent_emails (user_id, sent_at) where sent_at is not null;
