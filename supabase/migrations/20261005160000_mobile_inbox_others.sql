-- App del móvil: Others = lo que enseña "Todos" en el escritorio MENOS Primary, siempre al día.
-- Petición del dueño (05-10-2026): "Others enseña mensajes viejos". Medido en support@ el 04-10:
-- el 99,2 % de lo que entra es warm-up (37.525 de 37.827 en 7 días) y mobile_inbox_feed lo dejaba
-- fuera, así que lo más nuevo de Others era de hacía 25 horas. Además el móvil pedía lo nuevo por
-- received_at (la fecha del correo), y la sincronización guarda con retraso (p99 9 h; 2.615 correos
-- en 7 días llegaron con más de 1 h): lo que llegaba tarde no aparecía nunca con la app abierta.
--
--   1) mobile_inbox_others: TODO lo no archivado (warm-up, rebotes y avisos incluidos), lo más
--      nuevo primero, paginado por (received_at, id), o sólo lo guardado desde p_since_created.
--      La regla de campaña (inbox_campaign_match) se pasa sólo por lo que puede ser Primary: lo
--      enlazado y lo que no es warm-up (mismo conjunto que mobile_inbox_feed). El warm-up sin
--      enlazar nunca es Primary (de 17.643 coincidencias "responde" en 7 días, 565 se colaban).
--   2) mobile_inbox_feed (Primary = pestaña Campañas del escritorio) con p_since_created y
--      devolviendo created_at / is_warmup. La llamada de siempre (p_linked, p_other, p_since)
--      sigue funcionando: el parámetro nuevo tiene DEFAULT.
--   3) Índices parciales para que todo vaya por índice.
--
-- Los índices se crean sin CONCURRENTLY porque las migraciones van en una transacción;
-- inbox_messages tiene ~72.000 filas (130 MB) y cada uno tarda segundos. Si se prefiere sin
-- bloquear escrituras, ejecutarlos antes a mano con CREATE INDEX CONCURRENTLY (los IF NOT EXISTS
-- de aquí se saltan entonces).

-- Todo lo no archivado de un usuario, lo más nuevo primero (Others y su paginación).
create index if not exists idx_im_user_received_live
  on public.inbox_messages (user_id, received_at desc, id desc)
  where not is_archived;

-- Lo guardado desde un momento dado (lo nuevo, aunque el correo sea de hace horas).
create index if not exists idx_im_user_created_live
  on public.inbox_messages (user_id, created_at)
  where not is_archived;

-- Carril enlazado de Primary.
create index if not exists idx_im_user_linked_received
  on public.inbox_messages (user_id, received_at desc)
  where not is_archived and (lead_id is not null or campaign_id is not null);

-- Carril "resto sin warm-up" de Primary (antes recorría decenas de miles de filas de warm-up).
create index if not exists idx_im_user_other_received
  on public.inbox_messages (user_id, received_at desc)
  where not is_archived and lead_id is null and campaign_id is null and is_warmup is not true;

-- ── Primary ──────────────────────────────────────────────────────────────────────────────────
drop function if exists public.mobile_inbox_feed(int, int, timestamptz);
drop function if exists public.mobile_inbox_feed(int, int, timestamptz, timestamptz);
create function public.mobile_inbox_feed(
  p_linked int default 700,
  p_other int default 300,
  p_since timestamptz default null,
  p_since_created timestamptz default null
)
returns table (
  id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
  from_email text, from_name text, subject text, body_text text, received_at timestamptz,
  is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
  auto_signal text, to_emails text, cc_emails text, in_campaign boolean, campaign_hint uuid, match_why text,
  created_at timestamptz, is_warmup boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
begin
  if v_uid is null then
    return;
  end if;

  create temp table if not exists _mobile_feed_lane (
    id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
    from_email text, from_name text, subject text, body_text text, received_at timestamptz,
    is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
    auto_signal text, to_emails text, cc_emails text, created_at timestamptz, is_warmup boolean
  ) on commit drop;
  create temp table if not exists _mobile_feed_match (mid uuid primary key, in_campaign boolean, campaign_hint uuid, why text) on commit drop;
  truncate _mobile_feed_lane, _mobile_feed_match;

  if p_since_created is not null then
    -- Sólo lo guardado desde entonces (lo que llega tarde también): una consulta por created_at.
    insert into _mobile_feed_lane
    select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
           m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
           m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
      from inbox_messages m
     where m.user_id = v_uid and not m.is_archived
       and m.created_at > p_since_created
       and (m.lead_id is not null or m.campaign_id is not null or m.is_warmup is not true)
     order by m.created_at desc
     limit least(greatest(coalesce(p_linked, 0) + coalesce(p_other, 0), 0), 1000);
  else
    insert into _mobile_feed_lane
    (select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
            m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
            m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
       from inbox_messages m
      where m.user_id = v_uid and not m.is_archived
        and (m.lead_id is not null or m.campaign_id is not null)
        and (p_since is null or m.received_at > p_since)
      order by m.received_at desc
      limit least(greatest(p_linked, 0), 1000))
    union all
    (select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
            m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
            m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
       from inbox_messages m
      where m.user_id = v_uid and not m.is_archived
        and m.lead_id is null and m.campaign_id is null
        and m.is_warmup is not true
        and (p_since is null or m.received_at > p_since)
      order by m.received_at desc
      limit least(greatest(p_other, 0), 1000));
  end if;

  select array_agg(f.id) into v_ids from _mobile_feed_lane f;
  insert into _mobile_feed_match (mid, in_campaign, campaign_hint, why)
  select x.id, x.in_campaign, x.campaign_hint, x.why from public.inbox_campaign_match(v_uid, v_ids) x;

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           coalesce(x.in_campaign, false), x.campaign_hint, x.why,
           f.created_at, coalesce(f.is_warmup, false)
      from _mobile_feed_lane f
      left join _mobile_feed_match x on x.mid = f.id
     order by f.received_at desc, f.id desc;
end;
$$;

revoke all on function public.mobile_inbox_feed(int, int, timestamptz, timestamptz) from public, anon;
grant execute on function public.mobile_inbox_feed(int, int, timestamptz, timestamptz) to authenticated;

-- ── Others ───────────────────────────────────────────────────────────────────────────────────
drop function if exists public.mobile_inbox_others(int, timestamptz, uuid, timestamptz);
create function public.mobile_inbox_others(
  p_limit int default 200,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_since_created timestamptz default null
)
returns table (
  id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
  from_email text, from_name text, subject text, body_text text, received_at timestamptz,
  is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
  auto_signal text, to_emails text, cc_emails text, in_campaign boolean, campaign_hint uuid, match_why text,
  created_at timestamptz, is_warmup boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_ids uuid[];
begin
  if v_uid is null then
    return;
  end if;

  create temp table if not exists _mobile_others_lane (
    id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
    from_email text, from_name text, subject text, body_text text, received_at timestamptz,
    is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
    auto_signal text, to_emails text, cc_emails text, created_at timestamptz, is_warmup boolean
  ) on commit drop;
  create temp table if not exists _mobile_others_match (mid uuid primary key, in_campaign boolean, campaign_hint uuid, why text) on commit drop;
  truncate _mobile_others_lane, _mobile_others_match;

  if p_since_created is not null then
    -- Lo guardado desde entonces (por idx_im_user_created_live).
    insert into _mobile_others_lane
    select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
           m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
           m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
      from inbox_messages m
     where m.user_id = v_uid and not m.is_archived
       and m.created_at > p_since_created
     order by m.created_at desc
     limit v_limit;
  else
    -- Una página, de la más nueva hacia atrás (por idx_im_user_received_live).
    insert into _mobile_others_lane
    select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
           m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
           m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
      from inbox_messages m
     where m.user_id = v_uid and not m.is_archived
       and (p_before is null
            or (m.received_at, m.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by m.received_at desc, m.id desc
     limit v_limit;
  end if;

  -- La regla de campaña sólo para lo que puede ser Primary (lo mismo que mira mobile_inbox_feed).
  select array_agg(f.id) into v_ids
    from _mobile_others_lane f
   where f.lead_id is not null or f.campaign_id is not null or f.is_warmup is not true;
  if v_ids is not null then
    insert into _mobile_others_match (mid, in_campaign, campaign_hint, why)
    select x.id, x.in_campaign, x.campaign_hint, x.why from public.inbox_campaign_match(v_uid, v_ids) x;
  end if;

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           coalesce(x.in_campaign, false), x.campaign_hint, x.why,
           f.created_at, coalesce(f.is_warmup, false)
      from _mobile_others_lane f
      left join _mobile_others_match x on x.mid = f.id
     order by f.received_at desc, f.id desc;
end;
$$;

revoke all on function public.mobile_inbox_others(int, timestamptz, uuid, timestamptz) from public, anon;
grant execute on function public.mobile_inbox_others(int, timestamptz, uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
