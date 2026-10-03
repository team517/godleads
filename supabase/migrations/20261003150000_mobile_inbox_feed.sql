-- Bandeja de la app del móvil, con la regla de la Unibox de campaña:
--   un mensaje es DE CAMPAÑA si quien escribe es un lead que está en alguna campaña, o si su
--   dominio es el de algún lead que está en alguna campaña (un compañero de la misma empresa).
--   Los dominios de correo gratuito (gmail, hotmail…) no cuentan como "empresa": si no, cualquier
--   gmail entraría porque algún lead usa gmail (el warm-up llega casi todo desde gmail).
-- Dos carriles para que el warm-up no tape las respuestas: lo enlazado a un lead/campaña y, aparte,
-- lo demás que no viene marcado como warm-up.
--
-- plpgsql + SECURITY DEFINER con el usuario fijado en v_uid: así cada comprobación usa los
-- índices (email exacto: idx_leads_user_id_email; dominio: idx_leads_user_domain) y sólo se mira
-- una vez cada email/dominio distinto. Con RLS y auth.uid() en cada fila el planificador recorría
-- los 213.000 leads de support@ (de 2,7 s a 52 s). Todo va filtrado por v_uid = auth.uid().
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
  auto_signal text, to_emails text, cc_emails text, in_campaign boolean
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
  v_emails text[];
  v_domains text[];
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
  truncate _mobile_feed_lane;

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

  -- Emails que son lead de alguna campaña (una búsqueda por email distinto).
  select coalesce(array_agg(x.e), '{}') into v_emails
    from (select distinct lower(btrim(f.from_email)) e from _mobile_feed_lane f where f.from_email is not null) x
   where exists (
     select 1 from leads l
      where l.user_id = v_uid and l.email = x.e
        and exists (select 1 from campaign_leads cl where cl.lead_id = l.id)
   );

  -- Dominios de empresa con algún lead en alguna campaña (una búsqueda por dominio distinto).
  select coalesce(array_agg(x.d), '{}') into v_domains
    from (select distinct lower(split_part(btrim(f.from_email), '@', 2)) d from _mobile_feed_lane f where f.from_email like '%@%') x
   where x.d <> '' and not (x.d = any (v_free))
     and exists (
       select 1 from leads l
        where l.user_id = v_uid and lower(split_part(l.email, '@', 2)) = x.d
          and exists (select 1 from campaign_leads cl where cl.lead_id = l.id)
     );

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           (lower(btrim(f.from_email)) = any (v_emails)
            or lower(split_part(btrim(f.from_email), '@', 2)) = any (v_domains)) as in_campaign
      from _mobile_feed_lane f
     order by f.received_at desc;
end;
$$;

revoke all on function public.mobile_inbox_feed(int, int, timestamptz) from public, anon;
grant execute on function public.mobile_inbox_feed(int, int, timestamptz) to authenticated;
