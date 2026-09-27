-- "Modificaciones IA": el chat del equipo (hello@, support@, equipo@) que trabaja sobre la cuenta
-- de un cliente: ve sus campañas, mensajes, métricas y respuestas, y crea / cambia / borra
-- mensajes calcando los EJEMPLOS QUE FUNCIONAN.
--
-- Todo se toca desde la edge function `ia-modificaciones` con el service role: estas tablas no
-- tienen policies (RLS activado = nadie las lee desde el navegador).

-- ── Conversación por cliente (compartida por el equipo) ──────────────────────
create table if not exists public.ia_mod_messages (
  id              uuid primary key default gen_random_uuid(),
  client_user_id  uuid not null references auth.users(id) on delete cascade,
  author_email    text,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null default '',
  cards           jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists ia_mod_messages_client_idx on public.ia_mod_messages (client_user_id, created_at);
alter table public.ia_mod_messages enable row level security;

-- ── Memoria por cliente: lo que la IA aprende y no debe olvidar ──────────────
create table if not exists public.ia_mod_notes (
  client_user_id  uuid primary key references auth.users(id) on delete cascade,
  notes           text not null default '',
  updated_by      text,
  updated_at      timestamptz not null default now()
);
alter table public.ia_mod_notes enable row level security;

-- ── Cada cambio que hace la IA, con el antes y el después (para deshacer) ────
--    status: pending (espera el botón "Confirmar") | applied | undone | cancelled
create table if not exists public.ia_mod_changes (
  id              uuid primary key default gen_random_uuid(),
  client_user_id  uuid not null references auth.users(id) on delete cascade,
  author_email    text,
  kind            text not null,
  campaign_id     uuid,
  step_id         uuid,
  summary         text not null default '',
  payload         jsonb not null default '{}'::jsonb,
  before          jsonb,
  after           jsonb,
  status          text not null default 'applied',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists ia_mod_changes_client_idx on public.ia_mod_changes (client_user_id, created_at desc);
alter table public.ia_mod_changes enable row level security;

-- ── Insertar un mensaje en una posición sin descolocar a los leads ───────────
-- El motor sigue a cada lead por POSICIÓN (campaign_leads.current_step = cuántos pasos lleva) y
-- ordena los pasos por step_order, que según quién creó la campaña empieza en 0 o en 1. Aquí la
-- posición es siempre la real (1 = el primero) y los pasos quedan renumerados 1..n.
-- Si se mete un correo en medio, quien ya pasó esa posición avanza uno para no repetir el correo
-- que ya recibió; quien aún no ha llegado recibirá el nuevo.
create or replace function public.ia_step_insert(
  p_campaign uuid, p_pos int, p_subject text, p_body text, p_delay int, p_variants jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  n int;
  pos int;
  new_id uuid;
begin
  perform 1 from campaigns where id = p_campaign for update;
  select count(*) into n from campaign_steps where campaign_id = p_campaign;
  pos := least(greatest(coalesce(p_pos, n + 1), 1), n + 1);
  with o as (
    select id, row_number() over (order by step_order, created_at, id) rn
    from campaign_steps where campaign_id = p_campaign
  )
  update campaign_steps cs set step_order = case when o.rn >= pos then o.rn + 1 else o.rn end
  from o where cs.id = o.id;
  if pos <= n then
    update campaign_leads set current_step = current_step + 1
     where campaign_id = p_campaign and current_step >= pos;
  end if;
  insert into campaign_steps (campaign_id, step_order, subject, body, delay_days, variants)
  values (p_campaign, pos, coalesce(p_subject, ''), coalesce(p_body, ''), greatest(coalesce(p_delay, 0), 0), coalesce(p_variants, '[]'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

-- Borrar un mensaje: quien ya lo recibió retrocede uno (su siguiente sigue siendo el mismo
-- correo); quien aún no había llegado pasa directamente al de después. Devuelve la fila borrada
-- con su posición real ("posicion").
create or replace function public.ia_step_delete(p_step uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s campaign_steps%rowtype;
  pos int;
begin
  select * into s from campaign_steps where id = p_step;
  if not found then return null; end if;
  perform 1 from campaigns where id = s.campaign_id for update;
  select rn into pos from (
    select id, row_number() over (order by step_order, created_at, id) rn
    from campaign_steps where campaign_id = s.campaign_id
  ) o where o.id = p_step;
  delete from campaign_steps where id = p_step;
  with o as (
    select id, row_number() over (order by step_order, created_at, id) rn
    from campaign_steps where campaign_id = s.campaign_id
  )
  update campaign_steps cs set step_order = o.rn from o where cs.id = o.id;
  update campaign_leads set current_step = current_step - 1
   where campaign_id = s.campaign_id and current_step >= pos and current_step > 0;
  return to_jsonb(s) || jsonb_build_object('posicion', pos);
end;
$$;

-- ── Métricas de las campañas de un cliente (sin auth.uid: sólo el service role) ──
create or replace function public.ia_client_metrics(p_user uuid, p_days int default 7)
returns table (
  campaign_id uuid, name text, status text,
  sent bigint, contacted bigint, replied bigint, interested bigint, bounced bigint,
  sent_window bigint, replies_window bigint, leads_total bigint, leads_pending bigint
)
language sql stable security definer set search_path = public as $$
  with c as (select id, name, status from campaigns where user_id = p_user),
  win as (select now() - make_interval(days => greatest(p_days, 1)) as start_at),
  se as (
    select s.campaign_id,
      count(*) filter (where s.sent_at is not null) sent,
      count(distinct coalesce(s.lead_id::text, lower(s.to_email))) filter (where s.sent_at is not null) contacted,
      count(distinct coalesce(s.lead_id::text, lower(s.to_email))) filter (where s.bounced_at is not null) bounced,
      count(*) filter (where s.sent_at >= (select start_at from win)) sent_window
    from sent_emails s join c on c.id = s.campaign_id group by s.campaign_id
  ),
  im as (
    select m.campaign_id,
      count(distinct coalesce(m.lead_id::text, lower(m.from_email))) filter (where m.is_archived = false) replied,
      count(distinct coalesce(m.lead_id::text, lower(m.from_email))) filter (where m.labels @> array['Interesado']::text[]) interested,
      count(distinct coalesce(m.lead_id::text, lower(m.from_email))) filter (where m.is_archived = false and m.received_at >= (select start_at from win)) replies_window
    from inbox_messages m join c on c.id = m.campaign_id group by m.campaign_id
  ),
  cl as (
    select l.campaign_id, count(*) total, count(*) filter (where l.status in ('pending', 'in_progress')) pending
    from campaign_leads l join c on c.id = l.campaign_id group by l.campaign_id
  )
  select c.id, c.name, c.status,
    coalesce(se.sent, 0), coalesce(se.contacted, 0), coalesce(im.replied, 0), coalesce(im.interested, 0), coalesce(se.bounced, 0),
    coalesce(se.sent_window, 0), coalesce(im.replies_window, 0), coalesce(cl.total, 0), coalesce(cl.pending, 0)
  from c
  left join se on se.campaign_id = c.id
  left join im on im.campaign_id = c.id
  left join cl on cl.campaign_id = c.id;
$$;

-- Serie diaria (hora de Madrid) de envíos y respuestas; p_campaign null = todas las del cliente.
create or replace function public.ia_client_daily(p_user uuid, p_campaign uuid, p_days int default 14)
returns table (day date, sends bigint, replies bigint)
language sql stable security definer set search_path = public as $$
  with c as (select id from campaigns where user_id = p_user and (p_campaign is null or id = p_campaign)),
  days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (greatest(p_days, 1) - 1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day
  ),
  s as (
    select (x.sent_at at time zone 'Europe/Madrid')::date d, count(*) n
    from sent_emails x join c on c.id = x.campaign_id
    where x.sent_at >= now() - make_interval(days => greatest(p_days, 1) + 1)
    group by 1
  ),
  r as (
    select (m.received_at at time zone 'Europe/Madrid')::date d, count(*) n
    from inbox_messages m join c on c.id = m.campaign_id
    where m.is_archived = false and m.received_at >= now() - make_interval(days => greatest(p_days, 1) + 1)
    group by 1
  )
  select days.day, coalesce(s.n, 0), coalesce(r.n, 0)
  from days left join s on s.d = days.day left join r on r.d = days.day
  order by days.day;
$$;

revoke all on function public.ia_step_insert(uuid, int, text, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.ia_step_delete(uuid) from public, anon, authenticated;
revoke all on function public.ia_client_metrics(uuid, int) from public, anon, authenticated;
revoke all on function public.ia_client_daily(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.ia_step_insert(uuid, int, text, text, int, jsonb) to service_role;
grant execute on function public.ia_step_delete(uuid) to service_role;
grant execute on function public.ia_client_metrics(uuid, int) to service_role;
grant execute on function public.ia_client_daily(uuid, uuid, int) to service_role;
