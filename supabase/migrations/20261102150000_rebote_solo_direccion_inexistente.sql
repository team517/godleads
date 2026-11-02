-- Rebotados: sólo cuando la dirección del destinatario NO EXISTE (02-11-2026, petición del dueño).
-- Se aplica a todo lo que enseña la cifra (campañas, buzones, estadísticas, portal/informes y PulseBot).
-- Lo que usa el motor para dejar de escribir a una dirección muerta no cambia.

create or replace function public.bounce_is_lead_fault(p_error text)
 returns boolean language sql immutable set search_path to 'public' as $function$
  -- Rebote = la DIRECCIÓN no existe (02-11-2026, regla del dueño). Nada más cuenta: ni el login o los
  -- tiempos de espera de IONOS, ni buzón lleno, ni bloqueos por spam/listas/políticas, ni caducados,
  -- ni rechazos sin motivo. El aviso genérico de IONOS ("could not be reached", 5.0.0 definitivo)
  -- sí cuenta: su causa habitual es una dirección muerta.
  with e as (select regexp_replace(coalesce(p_error, ''), '(possible reasons|what you can do|posibles (causas|motivos))[\s\S]*$', '', 'i') t)
  select e.t ~* (
      '\m5\.1\.(0|1|2|3|6|10)\M|\m556\M|user unknown|unknown (user|recipient)|no such (user|recipient|address|mailbox|domain)'
   || '|user not found|recipient not found|address not found|recipnotfound|does ?n.?t exist|not exist|nonexistent|non-existent'
   || '|invalid (recipient|mailbox|address|user)|recipient (address )?(rejected|unknown|invalid)|address rejected'
   || '|mailbox (not found|unavailable|does not exist|not available|is disabled|has been disabled|inactive)|no mailbox'
   || '|account (that you tried to reach )?(has been |is )?(disabled|deleted|closed|inactive|suspended)|account does not exist|is inactive'
   || '|unrouteable|unroutable|domain (not found|does not exist|is not valid)|host (or domain name )?not found|does not accept mail'
   || '|no mx|null mx|could not be reached|no longer (exists|in use|active)'
   || '|no est.{1,2} presente|no exi?s?te|no acepta (mensajes|correo)|usuario (desconocido|inexistente)|direcci.{1,2}n (inexistente|incorrecta|no v.{1,2}lida)'
   || '|cuenta (inexistente|desactivada|deshabilitada|inactiva|no existe)|buz.{1,2}n (inexistente|no existe)')
  and not public.is_temporary_send_error(e.t)
  and not (e.t ~* (
      'spamhaus|blocked using|block ?list|black ?list|\mrbl\M|dnsbl|reputation|policy|polic.{1,2}a|spam|mimecast|envelope blocked'
   || '|over ?quota|quota exceeded|mailbox (is )?full|buz.{1,2}n lleno|insufficient (system )?storage|\m5\.2\.2\M'
   || '|message expired|expired|too large|size ?limit|recipsizelimit|timed? ?out|mail loop|hop count'))
  from e;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_account_stats(p_campaign_id uuid)
 RETURNS TABLE(account_id uuid, in_campaign_direct boolean, in_campaign_by_tag boolean, leads_assigned bigint, sent_total bigint, sent_today bigint, replied bigint, bounced bigint, campaigns_total bigint, campaigns_active bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH camp AS (
    -- Ownership gate: no row here → the function returns nothing at all.
    SELECT c.id,
           c.user_id,
           coalesce(c.account_tags, '{}'::text[])          AS account_tags,
           coalesce(c.timezone, 'Europe/Madrid')           AS tz
    FROM campaigns c
    WHERE c.id = p_campaign_id
      AND c.user_id = auth.uid()
  ),
  day_start AS (
    -- Midnight of "today" in the CAMPAIGN's timezone, as a timestamptz.
    SELECT (date_trunc('day', now() AT TIME ZONE camp.tz)) AT TIME ZONE camp.tz AS from_ts
    FROM camp
  ),
  direct AS (
    SELECT ca.account_id
    FROM campaign_accounts ca, camp
    WHERE ca.campaign_id = camp.id
  ),
  acct AS (
    -- The campaign's account set = direct picks ∪ tag overlap, over the OWNER's accounts.
    SELECT ea.id                                                   AS acc_id,
           ea.tags                                                 AS acc_tags,
           (ea.id IN (SELECT d.account_id FROM direct d))          AS is_direct,
           (coalesce(ea.tags, '{}'::text[]) && camp.account_tags)  AS is_by_tag
    FROM email_accounts ea, camp
    WHERE ea.user_id = camp.user_id
      AND (
        ea.id IN (SELECT d.account_id FROM direct d)
        OR coalesce(ea.tags, '{}'::text[]) && camp.account_tags
      )
  ),
  lead_counts AS (
    SELECT cl.assigned_account_id AS acc_id, count(*) AS n
    FROM campaign_leads cl
    WHERE cl.campaign_id = p_campaign_id
      AND cl.assigned_account_id IS NOT NULL
    GROUP BY cl.assigned_account_id
  ),
  sends AS (
    SELECT se.account_id AS acc_id,
           count(*) FILTER (
             WHERE se.sent_at IS NOT NULL OR se.status IN ('sent', 'bounced')
           )                                                                   AS n_total,
           count(*) FILTER (
             WHERE se.sent_at >= (SELECT ds.from_ts FROM day_start ds)
           )                                                                   AS n_today,
           count(DISTINCT se.lead_id) FILTER (WHERE se.replied_at IS NOT NULL) AS n_replied,
           count(*) FILTER (
             WHERE (se.bounced_at IS NOT NULL OR se.status = 'bounced') AND public.bounce_is_lead_fault(se.error_message)
           )                                                                   AS n_bounced
    FROM sent_emails se
    WHERE se.campaign_id = p_campaign_id
      AND se.account_id IS NOT NULL
    GROUP BY se.account_id
  ),
  shared AS (
    -- Smartlead's "Shared Campaign Status": in how many of the owner's campaigns does
    -- this account send (same direct ∪ tag rule), and how many of those are active.
    SELECT a.acc_id,
           count(*)                                        AS n_campaigns,
           count(*) FILTER (WHERE c2.status = 'active')     AS n_active
    FROM acct a
    JOIN campaigns c2 ON c2.user_id = (SELECT camp.user_id FROM camp)
    WHERE c2.id IN (SELECT ca.campaign_id FROM campaign_accounts ca WHERE ca.account_id = a.acc_id)
       OR coalesce(c2.account_tags, '{}'::text[]) && coalesce(a.acc_tags, '{}'::text[])
    GROUP BY a.acc_id
  )
  SELECT a.acc_id,
         a.is_direct,
         a.is_by_tag,
         coalesce(l.n, 0)::bigint,
         coalesce(s.n_total, 0)::bigint,
         coalesce(s.n_today, 0)::bigint,
         coalesce(s.n_replied, 0)::bigint,
         coalesce(s.n_bounced, 0)::bigint,
         coalesce(sh.n_campaigns, 0)::bigint,
         coalesce(sh.n_active, 0)::bigint
  FROM acct a
  LEFT JOIN lead_counts l ON l.acc_id = a.acc_id
  LEFT JOIN sends  s  ON s.acc_id  = a.acc_id
  LEFT JOIN shared sh ON sh.acc_id = a.acc_id
  ORDER BY a.acc_id;
$function$;

CREATE OR REPLACE FUNCTION public.client_campaign_stats(p_client_id uuid)
 RETURNS TABLE(campaign_id uuid, name text, status text, created_at timestamp with time zone, leads bigint, sent bigint, replied bigint, bounced bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         (select count(*) from sent_emails se where se.campaign_id = ca.id and se.bounced_at is not null and public.bounce_is_lead_fault(se.error_message))
  from campaigns ca
  where (ca.client_id = p_client_id and ca.user_id = v_owner)   -- del dueño, etiquetadas
     or (v_login is not null and ca.user_id = v_login)          -- de la propia cuenta del cliente
  order by ca.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ia_client_metrics(p_user uuid, p_days integer DEFAULT 7)
 RETURNS TABLE(campaign_id uuid, name text, status text, sent bigint, contacted bigint, replied bigint, interested bigint, bounced bigint, sent_window bigint, replies_window bigint, leads_total bigint, leads_pending bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (select id, name, status from campaigns where user_id = p_user),
  win as (select now() - make_interval(days => greatest(p_days, 1)) as start_at),
  se as (
    select s.campaign_id,
      count(*) filter (where s.sent_at is not null) sent,
      count(distinct coalesce(s.lead_id::text, lower(s.to_email))) filter (where s.sent_at is not null) contacted,
      count(distinct coalesce(s.lead_id::text, lower(s.to_email))) filter (where s.bounced_at is not null and public.bounce_is_lead_fault(s.error_message)) bounced,
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
$function$;

CREATE OR REPLACE FUNCTION public.report_bundle_admin(p_user_id uuid, p_days integer DEFAULT 2, p_chart_days integer DEFAULT 7)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (
    -- Only the client's ACTIVE campaigns (running now) — not drafts/paused/finished.
    select id, name from public.campaigns where user_id = p_user_id and status = 'active'
  ),
  se as (
    select s.campaign_id, lower(coalesce(s.to_email,'')) as email, s.status,
           s.sent_at, s.opened_at, s.replied_at, s.bounced_at, s.lead_id, s.error_message
    from public.sent_emails s join c on c.id = s.campaign_id
  ),
  agg as (
    select campaign_id,
      count(*) filter (where sent_at is not null or status='sent') as sent,
      count(distinct coalesce(lead_id::text, email)) filter (where sent_at is not null or status='sent') as contacted,
      count(*) filter (where opened_at is not null) as opened,
      count(*) filter (where bounced_at is not null and public.bounce_is_lead_fault(error_message)) as bounced,
      count(distinct coalesce(lead_id::text, email)) filter (where replied_at is not null) as replied
    from se group by campaign_id
  ),
  lc as (
    select campaign_id, count(*) as total, count(*) filter (where last_sent_at is not null) as contacted_leads
    from public.campaign_leads where campaign_id in (select id from c) group by campaign_id
  ),
  pos as (
    select im.campaign_id, count(*) as n from public.inbox_messages im join c on c.id=im.campaign_id
    where im.labels @> array['Interesado']::text[] group by im.campaign_id
  ),
  seq as (
    select cs.campaign_id, count(*) as n from public.campaign_steps cs join c on c.id=cs.campaign_id group by cs.campaign_id
  ),
  win as (select (now() - make_interval(days => p_days)) as start_at),
  firsts as (
    select s.campaign_id, coalesce(s.lead_id::text, lower(s.to_email)) as who, min(s.sent_at) as first_at
    from public.sent_emails s join c on c.id=s.campaign_id where s.sent_at is not null
    group by s.campaign_id, coalesce(s.lead_id::text, lower(s.to_email))
  ),
  newc as (select f.campaign_id, count(*) as n from firsts f, win where f.first_at >= win.start_at group by f.campaign_id),
  sentw as (select s.campaign_id, count(*) as n from public.sent_emails s join c on c.id=s.campaign_id, win
            where s.sent_at is not null and s.sent_at >= win.start_at group by s.campaign_id),
  repw as (select m.campaign_id, count(distinct coalesce(m.lead_id::text, lower(m.from_email))) as n
           from public.inbox_messages m join c on c.id=m.campaign_id, win
           where m.is_archived = false and m.received_at >= win.start_at group by m.campaign_id),
  days as (
    select generate_series(((now() at time zone 'Europe/Madrid')::date - (p_chart_days-1)),
      (now() at time zone 'Europe/Madrid')::date, interval '1 day')::date as day),
  dailies as (
    select c.id as campaign_id, d.day,
      (select count(*) from public.sent_emails s where s.campaign_id=c.id and s.sent_at is not null
         and (s.sent_at at time zone 'Europe/Madrid')::date = d.day) as sends,
      (select count(*) from public.inbox_messages m where m.campaign_id=c.id and m.is_archived=false
         and (m.received_at at time zone 'Europe/Madrid')::date = d.day) as replies
    from c cross join days d
  ),
  daily_agg as (
    select campaign_id, json_agg(json_build_object('day', to_char(day,'YYYY-MM-DD'), 'sends', sends, 'replies', replies) order by day) as daily
    from dailies group by campaign_id
  )
  select json_build_object('campaigns', coalesce(json_agg(json_build_object(
    'id', c.id, 'name', c.name,
    'sent', coalesce(agg.sent,0),
    'contacted', greatest(coalesce(lc.contacted_leads,0), coalesce(agg.replied,0)),
    'replied', coalesce(agg.replied,0),
    'opened', coalesce(agg.opened,0),
    'bounced', coalesce(agg.bounced,0),
    'positive', coalesce(pos.n,0),
    'sequences', coalesce(seq.n,0),
    'remaining', greatest(0, coalesce(lc.total,0) - coalesce(lc.contacted_leads,0)),
    'period_sent', coalesce(sentw.n,0),
    'period_new_contacts', coalesce(newc.n,0),
    'period_replies', coalesce(repw.n,0),
    'daily', coalesce(da.daily, '[]'::json)
  ) order by greatest(coalesce(lc.contacted_leads,0), coalesce(agg.replied,0)) desc), '[]'::json)) as bundle
  from c
  left join agg on agg.campaign_id=c.id
  left join lc on lc.campaign_id=c.id
  left join pos on pos.campaign_id=c.id
  left join seq on seq.campaign_id=c.id
  left join newc on newc.campaign_id=c.id
  left join sentw on sentw.campaign_id=c.id
  left join repw on repw.campaign_id=c.id
  left join daily_agg da on da.campaign_id=c.id;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_metrics_for_user(p_user_id uuid)
 RETURNS TABLE(campaign_id uuid, sent bigint, contacted bigint, opened bigint, bounced bigint, replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (
    select id from public.campaigns where user_id = auth.uid()
  ),
  pos as (
    select im.campaign_id, count(*) as n
    from public.inbox_messages im
    join c on c.id = im.campaign_id
    where im.labels @> array['Interesado']::text[]
    group by im.campaign_id
  ),
  seq as (
    select cs.campaign_id, count(*) as n
    from public.campaign_steps cs
    join c on c.id = cs.campaign_id
    group by cs.campaign_id
  )
  select c.id,
    x.sent, x.contacted, x.opened, x.bounced, x.replied, x.sender_bounced,
    coalesce(pos.n, 0), coalesce(seq.n, 0)
  from c
  cross join lateral (
    select a.sent, a.contacted, a.opened, a.bounced, a.replied, f.n as sender_bounced
    from (
      select
        count(*) filter (where s.sent_at is not null or s.status = 'sent') as sent,
        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))
          filter (where s.sent_at is not null or s.status = 'sent') as contacted,
        count(*) filter (where s.opened_at is not null) as opened,
        count(*) filter (where s.bounced_at is not null and public.bounce_is_lead_fault(s.error_message)) as bounced,
        count(distinct coalesce(s.lead_id::text, lower(coalesce(s.to_email, ''))))
          filter (where s.replied_at is not null) as replied
      from public.sent_emails s
      where s.campaign_id = c.id
    ) a,
    (
      select count(*) as n
      from (
        select lower(coalesce(s.to_email, '')) as email
        from public.sent_emails s
        where s.campaign_id = c.id
          and coalesce(s.to_email, '') <> ''
        group by 1
        having bool_or(s.status = 'failed' and not public.is_temporary_send_error(s.error_message))
           and not bool_or(s.sent_at is not null or s.status in ('sent', 'bounced'))
      ) g
    ) f
  ) x
  left join pos on pos.campaign_id = c.id
  left join seq on seq.campaign_id = c.id;
$function$;

CREATE OR REPLACE FUNCTION public.user_email_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as (
    select sent_at, opened_at, bounced_at, status, error_message, lower(to_email) as em
    from sent_emails where user_id = auth.uid()
  ),
  went as (select * from e where sent_at is not null or status in ('sent','bounced'))
  select json_build_object(
    'sent',      (select count(*) from went),
    'contacted', (select count(distinct em) from went where em is not null and em <> ''),
    'bounced', (select count(*) from e where (bounced_at is not null or status='bounced') and public.bounce_is_lead_fault(error_message)),
    'opened',  (select count(*) from e where opened_at is not null),
    'replied', (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and (m.lead_id is not null or m.campaign_id is not null))
             + (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and m.lead_id is null and m.campaign_id is null and m.is_warmup is not true
                  and (select 1 from leads l
                        where l.user_id = auth.uid() and position('@' in l.email) > 0
                          and lower(split_part(l.email,'@',2)) = lower(split_part(m.from_email,'@',2))
                        limit 1) is not null),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null and not public.is_temporary_send_error(error_message)
                  and em not in (select em from went where em is not null))
  );
$function$;

-- Las cifras guardadas se recalculan con la regla nueva.
update public.rpc_cache set computed_at = '-infinity';
