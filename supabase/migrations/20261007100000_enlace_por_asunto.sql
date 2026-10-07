-- Respuestas que llegan desde OTRA dirección y sin cabeceras de hilo (07-10-2026): el filtro
-- antispam Mailinblack ("Acabas de enviarme un e-mail por primera vez, haz clic…") contesta desde
-- <empresa>@invitations.mailinblack.com con "Re: <nuestro asunto>" y sin In-Reply-To. Quedaban
-- sueltos (sólo en "Todos"). Se enlazan con NUESTRO envío de campaña desde el MISMO buzón y con el
-- mismo asunto en los últimos 30 días, y sólo si ese asunto lo recibió UN único lead (si no, no
-- se sabe a cuál contesta y no se enlaza).

create or replace function public.subject_key(p text)
returns text language sql immutable set search_path to 'public' as $fn$
  select btrim(regexp_replace(lower(regexp_replace(coalesce(p, ''), '^\s*((re|rv|aw|fw|fwd|tr|res)\s*:\s*)+', '', 'i')), '\s+', ' ', 'g'));
$fn$;

create or replace function public.resolve_sent_by_subject(p_user uuid, p_account uuid, p_keys text[], p_before timestamptz default now())
returns table(skey text, lead_id uuid, campaign_id uuid)
language sql stable security definer set search_path to 'public' as $fn$
  with s as (
    select public.subject_key(e.subject) k, e.lead_id, e.campaign_id, e.created_at
    from public.sent_emails e
    where e.user_id = p_user and e.account_id = p_account
      and e.campaign_id is not null and e.lead_id is not null
      and e.created_at > p_before - interval '30 days' and e.created_at <= p_before + interval '1 hour'
  ), m as (
    select k, count(distinct lead_id) n, (array_agg(lead_id order by created_at desc))[1] lead_id, (array_agg(campaign_id order by created_at desc))[1] campaign_id
    from s where k = any (p_keys) and length(k) >= 8 group by k
  )
  select k, lead_id, campaign_id from m where n = 1;
$fn$;
revoke all on function public.resolve_sent_by_subject(uuid, uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_sent_by_subject(uuid, uuid, text[], timestamptz) to service_role;

-- Los que ya están guardados (sueltos, "Re: …", últimos 30 días): se enlazan igual. No marcan
-- al lead como "respondido" (un aviso de Mailinblack no es una respuesta del lead).
with c as (
  select m.id, r.lead_id, r.campaign_id
  from public.inbox_messages m
  cross join lateral public.resolve_sent_by_subject(m.user_id, m.account_id, array[public.subject_key(m.subject)], m.received_at) r
  where m.lead_id is null and m.campaign_id is null
    and coalesce(m.is_warmup, false) = false
    and m.received_at > now() - interval '30 days'
    and m.subject ~* '^\s*(re|rv|aw|res)\s*:'
    and m.account_id is not null
)
, u as (update public.inbox_messages m set lead_id = c.lead_id, campaign_id = c.campaign_id from c where m.id = c.id returning m.id)
delete from public.inbox_match_cache where mid in (select id from u);
