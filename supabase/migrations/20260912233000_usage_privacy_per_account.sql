-- El consumo de la FAMILIA es información del dueño del plan: le dice cuánto
-- gasta, clientes incluidos. Una cuenta de cliente NO debe verlo: le estaría
-- diciendo cuánto envía su agencia para todos los demás. Cada uno ve lo suyo.
drop function if exists public.my_monthly_send_usage();
create function public.my_monthly_send_usage()
returns table (enviados bigint, desde timestamptz, hasta timestamptz, cuentas int, es_dueno boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.plan_owner_of(auth.uid());
  v_es_dueno boolean := (v_owner = auth.uid());
  v_desde timestamptz := date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_hasta timestamptz := (date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month') at time zone 'Europe/Madrid';
begin
  return query
  select (select count(*) from sent_emails se
            where se.sent_at is not null and se.sent_at >= v_desde
              and (case when v_es_dueno
                        then se.user_id in (select public.plan_family_of(v_owner))
                        else se.user_id = auth.uid() end)),
         v_desde, v_hasta,
         (case when v_es_dueno then (select count(*)::int from public.plan_family_of(v_owner)) else 1 end),
         v_es_dueno;
end;
$$;
revoke all on function public.my_monthly_send_usage() from public;
grant execute on function public.my_monthly_send_usage() to authenticated;

-- Lo mismo con los buzones.
drop function if exists public.my_mailbox_usage();
create function public.my_mailbox_usage()
returns table (conectados bigint, totales bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.plan_owner_of(auth.uid());
  v_es_dueno boolean := (v_owner = auth.uid());
begin
  return query
  select (select count(*) from email_accounts e
            where e.status = 'connected'
              and (case when v_es_dueno
                        then e.user_id in (select public.plan_family_of(v_owner))
                        else e.user_id = auth.uid() end)),
         (select count(*) from email_accounts e
            where (case when v_es_dueno
                        then e.user_id in (select public.plan_family_of(v_owner))
                        else e.user_id = auth.uid() end));
end;
$$;
revoke all on function public.my_mailbox_usage() from public;
grant execute on function public.my_mailbox_usage() to authenticated;
