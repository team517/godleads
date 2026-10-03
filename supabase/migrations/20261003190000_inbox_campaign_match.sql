-- ¿Es DE CAMPAÑA este mensaje? Una sola regla para Primary (app del móvil), la pestaña Campañas
-- de la Unibox y los avisos de "Interesado":
--   lead    = quien escribe es un lead de alguna campaña, o alguien a quien escribimos desde una
--             campaña (un lead que luego salió de la campaña sigue siendo un lead directo);
--   dominio = escribe desde el dominio de empresa de un lead de alguna campaña (un compañero);
--             los dominios de correo gratuito (gmail, hotmail…) no cuentan;
--   hilo    = su In-Reply-To / References cita un correo NUESTRO de campaña (contesta a un envío
--             nuestro aunque sea desde otra dirección: "Juli ya no está", su gmail, otro dominio).
-- Y nunca lo es lo que lleva la marca del warm-up en el asunto ("Lucy - coffee? | KK5XRDN 0396QKE",
-- "… | blow_coat_avoid_beca 0396QKE"): el warm-up entraba pegado a una campaña y hacía sonar el
-- móvil (88 de 273 avisos en 14 días no eran de nadie de campaña).
-- Devuelve también la campaña (la del envío citado, la del lead o la de su dominio).
create or replace function public.inbox_campaign_match(p_user uuid, p_ids uuid[])
returns table (id uuid, in_campaign boolean, campaign_hint uuid, why text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_free text[] := array[
      'gmail.com','googlemail.com','hotmail.com','hotmail.es','hotmail.fr','hotmail.it','hotmail.co.uk',
      'outlook.com','outlook.es','outlook.fr','live.com','live.es','msn.com','yahoo.com','yahoo.es',
      'yahoo.fr','yahoo.co.uk','ymail.com','icloud.com','me.com','mac.com','aol.com','protonmail.com',
      'proton.me','pm.me','gmx.com','gmx.es','gmx.de','gmx.net','web.de','t-online.de','yandex.com',
      'yandex.ru','mail.com','mail.ru','zoho.com','telefonica.net','movistar.es','terra.es','ya.com',
      'wanadoo.es','orange.es','orange.fr','vodafone.es','libero.it','qq.com','163.com','tutanota.com'
  ];
begin
  if p_user is null or p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;

  create temp table if not exists _icm_msg (
    mid uuid primary key, em text, dom text, lead_id uuid, campaign_id uuid, refs text[], tagged boolean
  ) on commit drop;
  create temp table if not exists _icm_email (e text primary key, campaign_id uuid) on commit drop;
  create temp table if not exists _icm_domain (d text primary key, campaign_id uuid) on commit drop;
  create temp table if not exists _icm_ref (r text primary key, campaign_id uuid) on commit drop;
  truncate _icm_msg, _icm_email, _icm_domain, _icm_ref;

  insert into _icm_msg (mid, em, dom, lead_id, campaign_id, refs, tagged)
  select m.id,
         lower(btrim(m.from_email)),
         lower(split_part(btrim(m.from_email), '@', 2)),
         m.lead_id,
         m.campaign_id,
         array(select lower(x[1]) from regexp_matches(coalesce(m.in_reply_to, '') || ' ' || coalesce(m.ref_chain, ''), '(<[^<>[:space:]]+>)', 'g') x),
         -- La marca del warm-up: "| <algo> <CÓDIGO>" al final del asunto, con un código de 6 a 8
         -- mayúsculas y cifras mezcladas (la etiqueta de filtro del warm-up, p. ej. 0396QKE).
         (coalesce(m.subject, '') ~ '\|[^|]*[[:space:]][A-Z0-9]{6,8}[[:space:]]*$'
          and substring(coalesce(m.subject, '') from '([A-Z0-9]{6,8})[[:space:]]*$') ~ '[0-9]'
          and substring(coalesce(m.subject, '') from '([A-Z0-9]{6,8})[[:space:]]*$') ~ '[A-Z]')
    from inbox_messages m
   where m.id = any (p_ids) and m.user_id = p_user;

  -- lead: lead de una campaña (la de su último envío) o alguien a quien escribimos desde una campaña.
  insert into _icm_email (e, campaign_id)
  select x.e, coalesce(
      (select cl.campaign_id from leads l join campaign_leads cl on cl.lead_id = l.id
        where l.user_id = p_user and l.email = x.e
        order by cl.last_sent_at desc nulls last limit 1),
      (select s.campaign_id from sent_emails s
        where s.user_id = p_user and lower(s.to_email) = x.e and s.campaign_id is not null
        order by s.created_at desc limit 1))
    from (select distinct em as e from _icm_msg where em like '%@%') x;
  delete from _icm_email t where t.campaign_id is null;

  -- dominio: de empresa y con algún lead en alguna campaña (sin ORDER BY: rápido).
  insert into _icm_domain (d, campaign_id)
  select x.d, (
      select cl.campaign_id from leads l join campaign_leads cl on cl.lead_id = l.id
       where l.user_id = p_user and lower(split_part(l.email, '@', 2)) = x.d
       limit 1)
    from (select distinct dom as d from _icm_msg where dom <> '' and not (dom = any (v_free))) x;
  delete from _icm_domain t where t.campaign_id is null;

  -- hilo: Message-IDs citados que son envíos nuestros de campaña (idx_se_smtp_mid_lower).
  insert into _icm_ref (r, campaign_id)
  select x.r, (
      select s.campaign_id from sent_emails s
       where lower(s.smtp_message_id) = x.r and s.user_id = p_user and s.campaign_id is not null
       limit 1)
    from (select distinct unnest(refs) as r from _icm_msg) x;
  delete from _icm_ref t where t.campaign_id is null;

  return query
    select m.mid,
           (not m.tagged and (em.e is not null or dm.d is not null or rf.campaign_id is not null)) as in_campaign,
           case when m.tagged then null else coalesce(rf.campaign_id, m.campaign_id, em.campaign_id, dm.campaign_id) end as campaign_hint,
           case when m.tagged then 'warmup'
                when rf.campaign_id is not null then 'hilo'
                when em.e is not null then 'lead'
                when dm.d is not null then 'dominio'
                else null end as why
      from _icm_msg m
      left join _icm_email em on em.e = m.em
      left join _icm_domain dm on dm.d = m.dom
      left join lateral (
        select r.campaign_id from _icm_ref r where r.r = any (m.refs) limit 1
      ) rf on true;
end;
$$;

revoke all on function public.inbox_campaign_match(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.inbox_campaign_match(uuid, uuid[]) to service_role;

-- La misma regla para el usuario con sesión (Unibox del escritorio): sólo sus mensajes.
create or replace function public.inbox_campaign_match_mine(p_ids uuid[])
returns table (id uuid, in_campaign boolean, campaign_hint uuid, why text)
language sql
volatile
security definer
set search_path = public
as $$
  select * from public.inbox_campaign_match(auth.uid(), p_ids);
$$;
revoke all on function public.inbox_campaign_match_mine(uuid[]) from public, anon;
grant execute on function public.inbox_campaign_match_mine(uuid[]) to authenticated;

-- Bandeja de la app del móvil: los dos carriles de siempre + la regla de arriba.
drop function if exists public.mobile_inbox_feed(int, int, timestamptz);
create function public.mobile_inbox_feed(
  p_linked int default 900,
  p_other int default 300,
  p_since timestamptz default null
)
returns table (
  id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
  from_email text, from_name text, subject text, body_text text, received_at timestamptz,
  is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
  auto_signal text, to_emails text, cc_emails text, in_campaign boolean, campaign_hint uuid, match_why text
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
    auto_signal text, to_emails text, cc_emails text
  ) on commit drop;
  create temp table if not exists _mobile_feed_match (mid uuid primary key, in_campaign boolean, campaign_hint uuid, why text) on commit drop;
  truncate _mobile_feed_lane, _mobile_feed_match;

  insert into _mobile_feed_lane
  (select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
          m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
          m.auto_signal, m.to_emails, m.cc_emails
     from inbox_messages m
    where m.user_id = v_uid and not m.is_archived
      and (m.lead_id is not null or m.campaign_id is not null)
      and (p_since is null or m.received_at > p_since)
    order by m.received_at desc
    limit least(greatest(p_linked, 0), 2000))
  union all
  (select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
          m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
          m.auto_signal, m.to_emails, m.cc_emails
     from inbox_messages m
    where m.user_id = v_uid and not m.is_archived
      and m.lead_id is null and m.campaign_id is null
      and not coalesce(m.is_warmup, false)
      and (p_since is null or m.received_at > p_since)
    order by m.received_at desc
    limit least(greatest(p_other, 0), 1000));

  select array_agg(f.id) into v_ids from _mobile_feed_lane f;
  insert into _mobile_feed_match (mid, in_campaign, campaign_hint, why)
  select x.id, x.in_campaign, x.campaign_hint, x.why from public.inbox_campaign_match(v_uid, v_ids) x;

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           coalesce(x.in_campaign, false), x.campaign_hint, x.why
      from _mobile_feed_lane f
      left join _mobile_feed_match x on x.mid = f.id
     order by f.received_at desc;
end;
$$;

revoke all on function public.mobile_inbox_feed(int, int, timestamptz) from public, anon;
grant execute on function public.mobile_inbox_feed(int, int, timestamptz) to authenticated;
