-- Auditoría del correo entrante (02-10-2026): que ningún correo de un buzón conectado desaparezca
-- sin dejar rastro.
--
--  1. inbox_messages.auto_signal: la cabecera que delata una respuesta automática (Auto-Submitted,
--     X-Autoreply…). Antes sólo se miraba el texto.
--  2. email_accounts.imap_rescan: repaso de los últimos N días de un buzón, pedido o en curso.
--  3. inbox_ingest_log: lo que llega al buzón y NO se guarda como respuesta (rebotes, remitentes
--     automáticos sin relación, correos ilegibles, fallos al guardar) y lo que recupera un repaso.
--  4. Índices y funciones para enlazar una respuesta por su hilo (In-Reply-To / References → el
--     Message-ID del correo que enviamos) y para decidir qué falta en un repaso.
--  5. purge_old_warmup: borraba cada domingo TODO lo que no estuviera enlazado a un lead o campaña
--     con más de 7 días —fuera o no warm-up— y cualquier correo de un dominio bloqueado aunque
--     fuera una respuesta real. Ahora sólo borra lo marcado como warm-up.

alter table public.inbox_messages add column if not exists auto_signal text;
alter table public.email_accounts add column if not exists imap_rescan jsonb;

create table if not exists public.inbox_ingest_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  folder text not null default 'INBOX',
  uid_validity bigint not null default 0,
  uid bigint not null default 0,
  message_id text,
  from_email text,
  to_email text,
  subject text,
  received_at timestamptz,
  kind text not null,          -- bounce | auto_reply | human
  result text not null,        -- registrado | ignorado | fallo_bd | recuperado
  reason text,
  bounce_code text,
  bounce_class text,           -- recipient_gone | policy | temporary | other
  detail text,
  sent_email_id uuid,
  lead_id uuid,
  campaign_id uuid
);
create unique index if not exists inbox_ingest_log_msg_key on public.inbox_ingest_log (account_id, folder, uid_validity, uid, result);
create index if not exists inbox_ingest_log_user_created on public.inbox_ingest_log (user_id, created_at desc);
create index if not exists inbox_ingest_log_account_mid on public.inbox_ingest_log (account_id, lower(message_id));
alter table public.inbox_ingest_log enable row level security;
drop policy if exists "ingest log: owner reads" on public.inbox_ingest_log;
create policy "ingest log: owner reads" on public.inbox_ingest_log for select to authenticated using (user_id = auth.uid());

-- En producción estos dos se crearon con CREATE INDEX CONCURRENTLY, fuera de transacción.
create index if not exists idx_se_smtp_mid_lower on public.sent_emails (lower(smtp_message_id)) where smtp_message_id is not null;
create index if not exists idx_se_user_to_email_lower on public.sent_emails (user_id, lower(to_email));

-- Respuesta → el envío al que contesta, por el identificador del hilo.
create or replace function public.resolve_sent_by_refs(p_user uuid, p_refs text[])
returns table(ref text, lead_id uuid, campaign_id uuid, to_email text)
language sql stable security definer set search_path to 'public' as $fn$
  select distinct on (lower(s.smtp_message_id)) lower(s.smtp_message_id), s.lead_id, s.campaign_id, lower(s.to_email)
  from public.sent_emails s
  where s.user_id = p_user
    and s.smtp_message_id is not null
    and lower(s.smtp_message_id) = any(p_refs)
    and s.campaign_id is not null and s.lead_id is not null
  order by lower(s.smtp_message_id), s.created_at desc;
$fn$;
revoke all on function public.resolve_sent_by_refs(uuid, text[]) from public, anon, authenticated;
grant execute on function public.resolve_sent_by_refs(uuid, text[]) to service_role;

-- Repaso: de una tanda de cabeceras ya leídas del buzón, qué correos faltan y son nuestros.
-- Falta = no está en inbox_messages (por su Message-ID) ni anotado en inbox_ingest_log.
-- Nuestro = lo manda alguien a quien escribimos, contesta a un envío nuestro, viene de la empresa
-- de alguien a quien escribimos, es un rebote o lleva cabecera de respuesta automática.
create or replace function public.inbox_rescan_judge(p_user uuid, p_account uuid, p_items jsonb)
returns table(uid bigint, why text)
language sql stable security definer set search_path to 'public' as $fn$
  with it as (
    select (x->>'uid')::bigint as uid,
           nullif(lower(x->>'mid'), '') as mid,
           lower(coalesce(x->>'from', '')) as frm,
           coalesce((x->>'auto')::boolean, false) as auto,
           coalesce((x->>'daemon')::boolean, false) as daemon,
           (select array_agg(lower(r)) from jsonb_array_elements_text(coalesce(x->'refs', '[]'::jsonb)) r) as refs
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  ),
  falta as (
    select it.* from it
    where not exists (select 1 from public.inbox_messages m where m.user_id = p_user and m.dedupe_hash = 'mid:' || it.mid)
      and not exists (select 1 from public.inbox_ingest_log l where l.account_id = p_account and it.mid is not null and lower(l.message_id) = it.mid)
  ),
  juzgado as (
    select f.uid,
      case
        when f.daemon then 'rebote'
        when exists (select 1 from public.sent_emails s where s.user_id = p_user and lower(s.to_email) = f.frm) then 'lead'
        when f.refs is not null and exists (select 1 from public.sent_emails s where s.user_id = p_user and s.smtp_message_id is not null and lower(s.smtp_message_id) = any(f.refs)) then 'hilo'
        when split_part(f.frm, '@', 2) !~ '^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|protonmail|proton|gmx|mail|zoho|yandex|hey|fastmail|tutanota|qq|163|126|web|t-online|orange|wanadoo|free|libero|virgilio|telefonica|movistar|terra|ono)\.'
             and exists (select 1 from public.sent_emails s where s.user_id = p_user and lower(split_part(s.to_email, '@', 2)) = split_part(f.frm, '@', 2)) then 'dominio'
        when f.auto then 'auto'
        else null
      end as why
    from falta f
  )
  select j.uid, j.why from juzgado j where j.why is not null;
$fn$;
revoke all on function public.inbox_rescan_judge(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.inbox_rescan_judge(uuid, uuid, jsonb) to service_role;

-- Limpieza semanal del warm-up: SÓLO warm-up. Lo que no está enlazado pero tampoco es warm-up
-- (una respuesta desde otra dirección, un fuera de oficina de un alias, un correo de un dominio
-- bloqueado) ya no se borra. Tampoco se borra, aunque esté marcado como warm-up, lo que lleva
-- cabecera de respuesta automática ni lo que manda alguien a quien ese buzón escribió.
create or replace function public.purge_old_warmup(p_days integer default 7)
returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare v_deleted integer;
begin
  delete from public.inbox_messages m
  where m.received_at < now() - (p_days || ' days')::interval
    and coalesce(m.is_warmup, false)
    and m.lead_id is null and m.campaign_id is null
    and m.auto_signal is null
    and not coalesce(m.labels @> array['Importante']::text[], false)
    and not exists (select 1 from public.sent_emails s where s.account_id = m.account_id and s.to_email = lower(m.from_email));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $fn$;
revoke all on function public.purge_old_warmup(integer) from public, anon, authenticated;
grant execute on function public.purge_old_warmup(integer) to service_role;
