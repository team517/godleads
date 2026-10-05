-- Unibox › Campañas con UNA campaña elegida: todas sus respuestas, no sólo la ventana (05-10-2026).
-- El dueño: "en la campaña sale respondido y en el Unibox no sale" (cuenta creditoehipoteca).
-- Medido en todas las cuentas: de 3.604 leads "respondido", el Unibox bajo su campaña no enseñaba
--   · 867 porque la respuesta estaba archivada o eliminada (Eliminar = archivar) y no hay forma de
--     verla: creditoehipoteca 1 de 1, situateconnect 590 de 732, tcxmicro 259 de 364;
--   · 360 porque eran más viejas que la ventana de la pestaña (700 enlazadas más recientes):
--     hello@ 289, deitta 71.
-- Esta función trae, para la campaña elegida, cada correo recibido del lead de esa campaña (por
-- lead o por dirección, igual que el motor cuando marca "respondido") o enlazado a ella, archivado
-- o no, con la regla de campaña de siempre (inbox_campaign_match) para descartar el warm-up.
-- El escritorio enseña los archivados con su marca y un botón para recuperarlos.
drop function if exists public.campaign_inbox_feed(uuid, int);
create function public.campaign_inbox_feed(p_campaign uuid, p_limit int default 1000)
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
  v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_ids uuid[];
begin
  if v_uid is null or p_campaign is null
     or not exists (select 1 from campaigns c where c.id = p_campaign and c.user_id = v_uid) then
    return;
  end if;

  create temp table if not exists _camp_feed_lane (
    id uuid, account_id uuid, lead_id uuid, campaign_id uuid, message_id text,
    from_email text, from_name text, subject text, body_text text, received_at timestamptz,
    is_read boolean, is_archived boolean, folder_id uuid, labels text[], ref_chain text,
    auto_signal text, to_emails text, cc_emails text, created_at timestamptz, is_warmup boolean
  ) on commit drop;
  create temp table if not exists _camp_feed_match (mid uuid primary key, in_campaign boolean, why text) on commit drop;
  truncate _camp_feed_lane, _camp_feed_match;

  insert into _camp_feed_lane
  select m.id, m.account_id, m.lead_id, m.campaign_id, m.message_id, m.from_email, m.from_name, m.subject,
         m.body_text, m.received_at, m.is_read, m.is_archived, m.folder_id, m.labels, m.ref_chain,
         m.auto_signal, m.to_emails, m.cc_emails, m.created_at, m.is_warmup
    from inbox_messages m
   where m.user_id = v_uid
     and m.is_sent is not true
     and m.id in (
       -- enlazado a la campaña (idx_im_campaign)
       select x.id from inbox_messages x
        where x.campaign_id = p_campaign and x.user_id = v_uid
       union
       -- enlazado a un lead de la campaña (idx_inbox_messages_lead_id)
       select x.id from campaign_leads cl
         join inbox_messages x on x.lead_id = cl.lead_id
        where cl.campaign_id = p_campaign and x.user_id = v_uid
       union
       -- escrito desde la dirección de un lead de la campaña (idx_inbox_user_from_email)
       select x.id from campaign_leads cl
         join leads l on l.id = cl.lead_id
         join inbox_messages x on x.user_id = v_uid and lower(x.from_email) = lower(btrim(l.email))
        where cl.campaign_id = p_campaign)
   order by m.received_at desc, m.id desc
   limit v_limit;

  select array_agg(f.id) into v_ids from _camp_feed_lane f;
  if v_ids is not null then
    insert into _camp_feed_match (mid, in_campaign, why)
    select x.id, x.in_campaign, x.why from public.inbox_campaign_match(v_uid, v_ids) x;
  end if;

  return query
    select f.id, f.account_id, f.lead_id, f.campaign_id, f.message_id, f.from_email, f.from_name, f.subject,
           f.body_text, f.received_at, f.is_read, f.is_archived, f.folder_id, f.labels, f.ref_chain,
           f.auto_signal, f.to_emails, f.cc_emails,
           coalesce(x.in_campaign, false), p_campaign, x.why,
           f.created_at, coalesce(f.is_warmup, false)
      from _camp_feed_lane f
      left join _camp_feed_match x on x.mid = f.id
     order by f.received_at desc, f.id desc;
end;
$$;

revoke all on function public.campaign_inbox_feed(uuid, int) from public, anon;
grant execute on function public.campaign_inbox_feed(uuid, int) to authenticated;

notify pgrst, 'reload schema';
