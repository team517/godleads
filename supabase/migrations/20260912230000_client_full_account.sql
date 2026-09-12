-- ═══════════════════════════════════════════════════════════════════════════════
-- El cliente pasa a ser una CUENTA COMPLETA de la plataforma
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Cambio de modelo. Antes el cliente era un visor de solo lectura sobre los datos
-- del dueño. Ahora el cliente entra en la plataforma NORMAL: crea sus campañas,
-- conecta sus buzones y usa su Unibox, con sus propios datos bajo su propio
-- user_id. Por eso no hace falta abrir ninguna política: RLS ya funciona.
--
-- Lo que se cobra es la PLAZA de cliente (Growth 5 · Scale 10 · +15 $/mes), no la
-- cuenta. Ahí está el tope, y por eso una cuenta de cliente puede ser completa sin
-- que nadie acuñe cuentas ilimitadas gratis: para tener otra, hay que pagar plaza.
--
-- Lo que SÍ hay que arreglar: el consumo de los clientes tiene que sumar en el
-- plan del dueño ("los envíos de esos clientes van en mi mismo plan"). Para eso
-- está la "familia" de cuentas de abajo.

-- ── Secciones: las que el cliente necesita para trabajar de verdad ───────────
-- Crear campañas exige leads y buzones, así que entran en la lista.
alter table public.clients
  alter column allowed_sections set default
    '{dashboard,cuentas,campanas,leads,unibox,estadisticas}'::text[];

-- ── De sección a ruta real de la aplicación ─────────────────────────────────
-- Una sola traducción, para que el menú del cliente y su restricción de rutas no
-- puedan discrepar. `profiles.allowed_routes` se rellena con esto.
create or replace function public.client_routes_for_sections(p_sections text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct r order by r), '{}'::text[])
  from (
    select case s
             when 'dashboard'    then '/dashboard'
             when 'cuentas'      then '/email-accounts'
             when 'campanas'     then '/campaigns'
             when 'leads'        then '/leads'
             when 'unibox'       then '/unibox'
             when 'estadisticas' then '/stats'
             when 'ia'           then '/ai-prompts'
             else null
           end as r
    from unnest(coalesce(p_sections, '{}'::text[])) as s
  ) t
  where r is not null;
$$;

-- ── La "familia" de una cuenta: el dueño y sus clientes ─────────────────────
-- Dado cualquier user_id devuelve el dueño de su plan. Para un usuario normal es
-- él mismo; para una cuenta de cliente, la del dueño que la creó.
create or replace function public.plan_owner_of(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.owner_user_id from clients c where c.login_user_id = p_user_id and c.archived_at is null),
    p_user_id
  );
$$;

revoke all on function public.plan_owner_of(uuid) from public;
grant execute on function public.plan_owner_of(uuid) to authenticated, service_role;

/** Todos los user_id que consumen del plan de p_owner: él y sus clientes. */
create or replace function public.plan_family_of(p_owner uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p_owner
  union
  select c.login_user_id from clients c
   where c.owner_user_id = p_owner and c.login_user_id is not null and c.archived_at is null;
$$;

revoke all on function public.plan_family_of(uuid) from public;
grant execute on function public.plan_family_of(uuid) to authenticated, service_role;

-- ── Consumo del mes, SUMANDO al dueño y a sus clientes ──────────────────────
-- Sustituye la versión que sólo contaba al usuario que preguntaba: si un cliente
-- envía, eso gasta plan del dueño, y el dueño tiene que verlo.
-- Cambia el tipo de retorno (añade `cuentas`), así que hay que borrarla primero.
drop function if exists public.my_monthly_send_usage();
create function public.my_monthly_send_usage()
returns table (enviados bigint, desde timestamptz, hasta timestamptz, cuentas int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.plan_owner_of(auth.uid());
  v_desde timestamptz := date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_hasta timestamptz := (date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month') at time zone 'Europe/Madrid';
begin
  return query
  select (select count(*) from sent_emails se
            where se.user_id in (select public.plan_family_of(v_owner))
              and se.sent_at is not null and se.sent_at >= v_desde),
         v_desde,
         v_hasta,
         (select count(*)::int from public.plan_family_of(v_owner));
end;
$$;

revoke all on function public.my_monthly_send_usage() from public;
grant execute on function public.my_monthly_send_usage() to authenticated;

-- ── Buzones del plan, también sumando la familia ────────────────────────────
create or replace function public.my_mailbox_usage()
returns table (conectados bigint, totales bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid := public.plan_owner_of(auth.uid());
begin
  return query
  select (select count(*) from email_accounts e
            where e.user_id in (select public.plan_family_of(v_owner)) and e.status = 'connected'),
         (select count(*) from email_accounts e
            where e.user_id in (select public.plan_family_of(v_owner)));
end;
$$;

revoke all on function public.my_mailbox_usage() from public;
grant execute on function public.my_mailbox_usage() to authenticated;

-- ── Las cifras de un cliente, ahora de SU PROPIA cuenta ─────────────────────
-- Un cliente con cuenta tiene sus campañas bajo su user_id. Se siguen contando
-- además las del dueño etiquetadas con ese cliente, para quien trabaje de las dos
-- formas.
create or replace function public.client_campaign_stats(p_client_id uuid)
returns table (
  campaign_id uuid,
  name        text,
  status      text,
  created_at  timestamptz,
  leads       bigint,
  sent        bigint,
  replied     bigint,
  bounced     bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_owner uuid; v_login uuid;
begin
  select c.owner_user_id, c.login_user_id into v_owner, v_login
  from clients c
  where c.id = p_client_id and c.archived_at is null
    and (c.owner_user_id = auth.uid() or c.login_user_id = auth.uid());
  if v_owner is null then return; end if;

  return query
  select ca.id, ca.name, ca.status, ca.created_at,
         (select count(*) from campaign_leads cl where cl.campaign_id = ca.id),
         (select count(*) from sent_emails se where se.campaign_id = ca.id and se.sent_at is not null),
         (select count(distinct coalesce(se.lead_id::text, lower(se.to_email)))
            from sent_emails se where se.campaign_id = ca.id and se.replied_at is not null),
         (select count(*) from sent_emails se where se.campaign_id = ca.id and se.bounced_at is not null)
  from campaigns ca
  where (ca.client_id = p_client_id and ca.user_id = v_owner)   -- del dueño, etiquetadas
     or (v_login is not null and ca.user_id = v_login)          -- de la propia cuenta del cliente
  order by ca.created_at desc;
end;
$$;

revoke all on function public.client_campaign_stats(uuid) from public;
grant execute on function public.client_campaign_stats(uuid) to authenticated;
