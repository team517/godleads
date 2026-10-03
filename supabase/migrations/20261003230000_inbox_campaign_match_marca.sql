-- Regla "de campaña": quinto criterio, MARCA = la misma empresa con otra terminación de dominio
-- (lead en kurago.es → escribe alguien de kurago.software), con domain_brand (ya usado por
-- fetch-inbox para enlazar respuestas). Petición del dueño, 03-10-2026: "un dominio similar de
-- alguien de los leads… cualquier tipo de mensaje que envíen desde ahí entra" (fuera de la
-- oficina incluido: eso lo decide la app, que ahora pone en Primary TODO lo de campaña).
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
  create temp table if not exists _icm_own_dom (d text primary key) on commit drop;
  create temp table if not exists _icm_own_mail (e text primary key) on commit drop;
  create temp table if not exists _icm_brand (d text primary key, campaign_id uuid) on commit drop;
  truncate _icm_msg, _icm_email, _icm_domain, _icm_ref, _icm_own_dom, _icm_own_mail, _icm_brand;

  -- Los buzones del usuario (y sus dominios): para "responde" y para no contar el correo que se
  -- mandan entre ellos (el warm-up entre buzones propios también cita nuestro dominio).
  insert into _icm_own_mail (e)
  select distinct lower(btrim(a.email)) from email_accounts a where a.user_id = p_user and a.email like '%@%'
  on conflict do nothing;
  insert into _icm_own_dom (d)
  select distinct split_part(e, '@', 2) from _icm_own_mail where split_part(e, '@', 2) <> ''
  on conflict do nothing;

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

  -- marca: la misma empresa con otra terminación (lead en kurago.es, escribe alguien de
  -- kurago.software). domain_brand descarta correo gratuito y nombres genéricos (info, group,
  -- consulting…); nunca desde subdominios de envío masivo (news., mailing.…) ni desde los nuestros.
  -- Usa idx_leads_user_brand.
  insert into _icm_brand (d, campaign_id)
  select x.d, (
      select cl.campaign_id from leads l join campaign_leads cl on cl.lead_id = l.id
       where l.user_id = p_user
         and public.domain_brand(lower(split_part(l.email, '@', 2))) = x.b
       limit 1)
    from (select distinct dom as d, public.domain_brand(dom) as b from _icm_msg
           where dom <> '' and not (dom = any (v_free))) x
   where x.b is not null
     and x.d !~ '^(news|newsletter|newsletters|mailing|marketing|email|em|e|mail|info|noticias|notification|notifications|noreply|no-reply|bounce|bounces|campaign|campaigns|mkt)\.'
     and not exists (select 1 from _icm_own_dom o where o.d = x.d);
  delete from _icm_brand t where t.campaign_id is null;

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
           (not m.tagged and not (om.e is not null)
            and (em.e is not null or dm.d is not null or rf.campaign_id is not null or ow.d is not null or br.d is not null)) as in_campaign,
           case when m.tagged or om.e is not null then null
                else coalesce(rf.campaign_id, m.campaign_id, em.campaign_id, dm.campaign_id, br.campaign_id) end as campaign_hint,
           case when m.tagged then 'warmup'
                when om.e is not null then 'propio'
                when rf.campaign_id is not null then 'hilo'
                when em.e is not null then 'lead'
                when dm.d is not null then 'dominio'
                when ow.d is not null then 'responde'
                when br.d is not null then 'marca'
                else null end as why
      from _icm_msg m
      left join _icm_email em on em.e = m.em
      left join _icm_domain dm on dm.d = m.dom
      left join _icm_brand br on br.d = m.dom
      left join lateral (
        select r.campaign_id from _icm_ref r where r.r = any (m.refs) limit 1
      ) rf on true
      left join _icm_own_mail om on om.e = m.em
      -- responde: cita un Message-ID de uno de NUESTROS dominios (lo envió uno de nuestros
      -- buzones, desde esta plataforma o desde otra: campañas viejas de otra herramienta).
      left join lateral (
        select o.d from _icm_own_dom o
         where o.d = any (array(select rtrim(split_part(x, '@', 2), '>') from unnest(m.refs) x))
         limit 1
      ) ow on true;
end;
$$;

revoke all on function public.inbox_campaign_match(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.inbox_campaign_match(uuid, uuid[]) to service_role;
