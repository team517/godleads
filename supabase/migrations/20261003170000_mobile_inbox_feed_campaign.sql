-- mobile_inbox_feed con la CAMPAÑA de cada respuesta de campaña (campaign_hint).
-- Una respuesta que cuenta como de campaña sólo por el email o el dominio (un compañero de la
-- empresa, o un mensaje que no se enlazó) no traía campaign_id: al filtrar por campaña en el
-- móvil no salía. Ahora se devuelve la campaña del lead que coincide (la del último envío).
-- Lo demás, igual que 20261003150000 (ver allí el porqué de plpgsql + SECURITY DEFINER).
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
  auto_signal text, to_emails text, cc_emails text, in_campaign boolean, campaign_hint uuid
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_free text[] := array[
      'gmail.com','googlemail.com','hotmail.com','hotmail.es','hotmail.fr','hotmail.it','hotmail.co.uk',
      'outlook.com','outlook.es','outlook.fr','live.com','live.es','msn.com','yahoo.com','yahoo.es',
      'yahoo.fr','yahoo.co.uk','ymail.com','icloud.com','me.com','mac.com','aol.com','protonmail.com',
      'proton.me','pm.me','gmx.com','gmx.es','gmx.de','gmx.net','web.de','t-online.de','yandex.com',
      'yandex.ru','mail.com','mail.ru','zoho.com','telefonica.net','movistar.es','terra.es','ya.com',
      'wanadoo.es','orange.es','orange.fr','vodafone.es','libero.it','qq.com','163.com','tutanota.com'
  ];
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
  create temp table if not exists _mobile_feed_email (e text primary key, campaign_id uuid) on commit drop;
  create temp table if not exists _mobile_feed_domain (d text primary key, campaign_id uuid) on commit drop;
  truncate _mobile_feed_lane, _mobile_feed_email, _mobile_feed_domain;

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

  -- Emails que son lead de alguna campaña, con la campaña de su último envío (una búsqueda por email).
  insert into _mobile_feed_email (e, campaign_id)
  select x.e, (
      select cl.campaign_id from leads l join campaign_leads cl on cl.lead_id = l.id
       where l.user_id = v_uid and l.email = x.e
       order by cl.last_sent_at desc nulls last
       limit 1)
    from (select distinct lower(btrim(f.from_email)) e from _mobile_feed_lane f where f.from_email is not null) x;
  delete from _mobile_feed_email t where t.campaign_id is null;

  -- Dominios de empresa con algún lead en alguna campaña, y una campaña de ese dominio (una empresa
  -- suele estar en una sola). Sin ORDER BY: ordenar todos los leads de cada dominio subía la carga
  -- completa de 0,5 s a 2,2 s en support@.
  insert into _mobile_feed_domain (d, campaign_id)
  select x.d, (
      select cl.campaign_id from leads l join campaign_leads cl on cl.lead_id = l.id
       where l.user_id = v_uid and lower(split_part(l.email, '@', 2)) = x.d
       limit 1)
    from (select distinct lower(split_part(btrim(f.from_email), '@', 2)) d from _mobile_feed_lane f where f.from_email like '%@%') x
   where x.d <> '' and not (x.d = any (v_free));
  delete from _mobile_feed_domain t where t.campaign_id is null;

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           (em.e is not null or dm.d is not null) as in_campaign,
           coalesce(em.campaign_id, dm.campaign_id) as campaign_hint
      from _mobile_feed_lane f
      left join _mobile_feed_email em on em.e = lower(btrim(f.from_email))
      left join _mobile_feed_domain dm on dm.d = lower(split_part(btrim(f.from_email), '@', 2))
     order by f.received_at desc;
end;
$$;

revoke all on function public.mobile_inbox_feed(int, int, timestamptz) from public, anon;
grant execute on function public.mobile_inbox_feed(int, int, timestamptz) to authenticated;
