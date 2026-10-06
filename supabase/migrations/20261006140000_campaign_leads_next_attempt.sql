-- Reintento CON ESPERA en el motor (06-10-2026). Un fallo pasajero del destinatario ("Recipient
-- rejected: 451 local error in processing", greylisting, timeouts) se reintentaba en la pasada
-- siguiente y a los ~5 minutos el lead quedaba 'failed' (98 de 171 en 7 días). Ahora el motor
-- aplaza el lead: 10 min, 1 h, 4 h y 24 h; al 5.º fallo, 'failed'. El contador de intentos ya
-- existe (filas 'failed' de sent_emails por campaña+paso+dirección), así que sólo hace falta la
-- fecha del próximo intento. NULL = puede enviarse ya. El motor tolera que la columna no exista.
alter table public.campaign_leads add column if not exists next_attempt_at timestamptz;

-- Los seguimientos del reparto (mix) tampoco deben salir antes de su reintento.
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
    and (cl.next_attempt_at is null or cl.next_attempt_at <= now())
    and (cl.assigned_account_id is null or p_exclude is null or not (cl.assigned_account_id = any(p_exclude)))
  order by cl.last_sent_at asc nulls first
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$fn$;
revoke all on function public.campaign_due_followups(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.campaign_due_followups(uuid, uuid[], integer) to service_role;
