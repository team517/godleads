-- ═══════════════════════════════════════════════════════════════════════════════
-- Las secciones del cliente pasan a ser las REALES de la aplicación
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Antes la lista blanca era inventada (resumen, campanas, respuestas, informes).
-- El propietario quiere abrirle al cliente las secciones que existen de verdad:
--   dashboard · campanas · unibox · estadisticas · ia
--
-- El cliente sigue sin ser inquilino y sigue sin leer ninguna tabla por RLS: cada
-- sección tiene su función de servidor, y todas comprueban lo mismo — quien
-- pregunta es el DUEÑO del cliente o la cuenta de acceso DE ESE cliente.

-- Traducción de los nombres viejos a los nuevos, para no perder lo ya configurado.
update public.clients
set allowed_sections = (
  select coalesce(array_agg(distinct s), '{}'::text[])
  from (
    select case x
             when 'resumen'    then 'dashboard'
             when 'campanas'   then 'campanas'
             when 'respuestas' then 'unibox'
             when 'informes'   then 'estadisticas'
             else null
           end as s
    from unnest(allowed_sections) as x
  ) t
  where s is not null
)
where allowed_sections && '{resumen,respuestas,informes}'::text[];

alter table public.clients
  alter column allowed_sections set default '{dashboard,campanas,unibox,estadisticas}'::text[];

-- ── El Unibox del cliente: las respuestas a SUS campañas ─────────────────────
create or replace function public.client_inbox(p_client_id uuid, p_limit int default 50, p_offset int default 0)
returns table (
  id            uuid,
  received_at   timestamptz,
  from_email    text,
  from_name     text,
  subject       text,
  preview       text,
  labels        text[],
  campaign_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  select c.owner_user_id into v_owner
  from clients c
  where c.id = p_client_id and c.archived_at is null
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());
  if v_owner is null then return; end if;

  return query
  select im.id, im.received_at, im.from_email, im.from_name, im.subject,
         -- Solo un adelanto: el cliente no necesita el cuerpo entero, y así no se
         -- expone la firma ni la cita del hilo.
         left(regexp_replace(coalesce(im.body_text, ''), '\s+', ' ', 'g'), 220),
         -- La marca interna "IA" no se le muestra.
         (select coalesce(array_agg(l), '{}'::text[]) from unnest(coalesce(im.labels,'{}'::text[])) l where l <> 'IA'),
         ca.name
  from inbox_messages im
  join campaigns ca on ca.id = im.campaign_id
  where ca.client_id = p_client_id
    and ca.user_id = v_owner
    and im.user_id = v_owner
    and coalesce(im.is_warmup, false) = false
    and coalesce(im.is_archived, false) = false
  order by im.received_at desc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
end;
$$;

revoke all on function public.client_inbox(uuid, int, int) from public;
grant execute on function public.client_inbox(uuid, int, int) to authenticated;

-- ── Estadísticas: envíos y respuestas por día ────────────────────────────────
create or replace function public.client_daily_stats(p_client_id uuid, p_days int default 30)
returns table (dia date, enviados bigint, respuestas bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid; v_days int := greatest(1, least(p_days, 180));
begin
  select c.owner_user_id into v_owner
  from clients c
  where c.id = p_client_id and c.archived_at is null
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());
  if v_owner is null then return; end if;

  return query
  with dias as (
    select (current_date - (n || ' days')::interval)::date as dia
    from generate_series(0, v_days - 1) n
  ),
  campanas as (
    select id from campaigns where client_id = p_client_id and user_id = v_owner
  )
  select d.dia,
         (select count(*) from sent_emails se
            where se.campaign_id in (select id from campanas)
              and se.sent_at::date = d.dia) ,
         (select count(*) from sent_emails se
            where se.campaign_id in (select id from campanas)
              and se.replied_at::date = d.dia)
  from dias d
  order by d.dia;
end;
$$;

revoke all on function public.client_daily_stats(uuid, int) from public;
grant execute on function public.client_daily_stats(uuid, int) to authenticated;

-- ── IA: cómo ha clasificado la IA las respuestas del cliente ─────────────────
-- Es lo que la IA hace de cara al cliente: leer cada respuesta y ponerle
-- categoría. Se devuelve el recuento por categoría, más cuántas contestó la IA.
create or replace function public.client_ai_stats(p_client_id uuid)
returns table (categoria text, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  select c.owner_user_id into v_owner
  from clients c
  where c.id = p_client_id and c.archived_at is null
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());
  if v_owner is null then return; end if;

  return query
  select l as categoria, count(*) as total
  from inbox_messages im
  join campaigns ca on ca.id = im.campaign_id
  cross join unnest(coalesce(im.labels, '{}'::text[])) as l
  where ca.client_id = p_client_id
    and ca.user_id = v_owner
    and coalesce(im.is_warmup, false) = false
    and l <> 'IA'
  group by l
  order by count(*) desc;
end;
$$;

revoke all on function public.client_ai_stats(uuid) from public;
grant execute on function public.client_ai_stats(uuid) to authenticated;

-- ── El estado de configuración usa los nombres nuevos ────────────────────────
create or replace function public.client_setup_state(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'datos',    (c.name is not null and c.name <> ''),
    'acceso',   (c.login_user_id is not null),
    'logo',     (coalesce(c.logo_url,'') <> ''),
    'colores',  (coalesce(c.brand_color,'') <> ''),
    'permisos', (coalesce(array_length(c.allowed_sections,1),0) > 0),
    'campanas', (select count(*) > 0 from campaigns ca where ca.client_id = c.id)
  )
  from clients c
  where c.id = p_client_id
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());
$$;

revoke all on function public.client_setup_state(uuid) from public;
grant execute on function public.client_setup_state(uuid) to authenticated;
