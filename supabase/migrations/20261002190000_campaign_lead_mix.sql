-- Reparto del día entre PRIMEROS CORREOS y SEGUIMIENTOS, por campaña (02-10-2026).
-- El motor vaciaba primero todos los seguimientos: con una cola atrasada salían días enteros sin
-- un solo primer correo (support@, 02-10: 6.037 envíos, 0 leads nuevos, 23 respuestas).
--
--  · mix_mode:   'off'    = como siempre (seguimientos primero)
--                'auto'   = equilibrio según los pasos de la secuencia (3 pasos → 35 % nuevos)
--                'manual' = el % de la barra
--  · new_lead_pct: % de leads nuevos en modo manual.
--  · max_new_per_day: tope opcional de leads nuevos al día (para que la lista no se acabe rápido).
-- La lógica vive en supabase/functions/_shared/lead-mix.ts; aquí sólo están los datos que necesita.

alter table public.campaigns add column if not exists mix_mode text not null default 'off';
alter table public.campaigns add column if not exists new_lead_pct smallint not null default 35;
alter table public.campaigns add column if not exists max_new_per_day integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_mix_mode_check') then
    alter table public.campaigns add constraint campaigns_mix_mode_check check (mix_mode in ('off', 'auto', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_new_lead_pct_check') then
    alter table public.campaigns add constraint campaigns_new_lead_pct_check check (new_lead_pct between 0 and 100);
  end if;
end $$;

-- Estado del día de una campaña para el reparto: lo enviado hoy por parte y por buzón, los leads
-- nuevos que esperan y los seguimientos que tocan hoy por buzón. "Tocan hoy" = el siguiente paso
-- vence antes de p_day_end (el cierre de la franja). El paso siguiente se busca por POSICIÓN en
-- la secuencia (hay campañas que numeran desde 0 y otras desde 1), igual que hace el motor.
create or replace function public.campaign_mix_state(p_campaign uuid, p_today_start timestamptz, p_day_end timestamptz)
returns json
language sql stable security definer set search_path to 'public' as $fn$
  with st as (
    select s.id, s.delay_days, row_number() over (order by s.step_order) as pos
    from public.campaign_steps s where s.campaign_id = p_campaign),
  sent as (
    select e.account_id,
           count(*) filter (where st.pos = 1) as new_sent,
           count(*) filter (where st.pos is distinct from 1) as fu_sent
    from public.sent_emails e left join st on st.id = e.campaign_step_id
    where e.campaign_id = p_campaign and e.sent_at >= p_today_start
    group by e.account_id),
  due as (
    select cl.assigned_account_id as account_id, count(*) as fu_due
    from public.campaign_leads cl
    join st on st.pos = coalesce(cl.current_step, 0) + 1
    where cl.campaign_id = p_campaign and cl.status = 'in_progress' and coalesce(cl.current_step, 0) >= 1
      and (cl.last_sent_at is null or cl.last_sent_at + make_interval(days => coalesce(st.delay_days, 0)) <= p_day_end)
    group by cl.assigned_account_id),
  ids as (select account_id from sent union select account_id from due)
  select json_build_object(
    'new_pending', (select count(*) from (select 1 from public.campaign_leads cl where cl.campaign_id = p_campaign and cl.status = 'pending' limit 200000) q),
    'new_sent', coalesce((select sum(new_sent) from sent), 0),
    'fu_sent', coalesce((select sum(fu_sent) from sent), 0),
    'fu_due', coalesce((select sum(fu_due) from due), 0),
    'accounts', coalesce((select json_agg(json_build_object(
        'id', i.account_id,
        'fu_due', coalesce(d.fu_due, 0),
        'fu_sent', coalesce(s.fu_sent, 0),
        'new_sent', coalesce(s.new_sent, 0)))
      from ids i left join sent s on s.account_id is not distinct from i.account_id
                 left join due d on d.account_id is not distinct from i.account_id), '[]'::json));
$fn$;
revoke all on function public.campaign_mix_state(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.campaign_mix_state(uuid, timestamptz, timestamptz) to service_role;

-- Los seguimientos que se pueden enviar AHORA, los más antiguos primero, dejando fuera los de los
-- buzones que hoy ya no pueden enviar más seguimientos (p_exclude). Sin esto, con una cola larga
-- los primeros puestos de la lista los ocupaban leads de buzones ya servidos y el motor no
-- llegaba a los demás.
create or replace function public.campaign_due_followups(p_campaign uuid, p_exclude uuid[], p_limit integer default 500)
returns setof public.campaign_leads
language sql stable security definer set search_path to 'public' as $fn$
  with st as (
    select s.delay_days, row_number() over (order by s.step_order) as pos
    from public.campaign_steps s where s.campaign_id = p_campaign)
  select cl.*
  from public.campaign_leads cl
  left join st on st.pos = coalesce(cl.current_step, 0) + 1
  where cl.campaign_id = p_campaign and cl.status = 'in_progress'
    and (coalesce(cl.current_step, 0) = 0 or cl.last_sent_at is null
         or cl.last_sent_at + make_interval(days => coalesce(st.delay_days, 0)) <= now())
    and (cl.assigned_account_id is null or p_exclude is null or not (cl.assigned_account_id = any(p_exclude)))
  order by cl.last_sent_at asc nulls first
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$fn$;
revoke all on function public.campaign_due_followups(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.campaign_due_followups(uuid, uuid[], integer) to service_role;
