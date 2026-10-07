-- "Respondidos" exacto (07-10-2026).
-- Un correo que se enlaza a su lead DESPUÉS de entrar (repasos, enlace por asunto, regla de campaña)
-- no sumaba en "Respondidos": fetch-inbox sólo marca sent_emails.replied_at al guardarlo.
-- Auditoría del 07-10: 57 leads con respuesta enlazada y sin contar (OOO, compañeros que contestan
-- "RE: …", antispam xefi…). Ahora:
--   1. inbox_reply_counts(): decide si un entrante enlazado cuenta como respuesta.
--   2. Trigger al cambiar lead_id / campaign_id de un entrante: marca el envío de ESA campaña.
--   3. Repaso de lo que ya hay (con copia para deshacer).
-- No cuentan: warm-up, enviados, avisos de "no entregado" (NDR) y, si escribe otra persona del
-- dominio, un hilo nuevo que no es respuesta (misma regla que fetch-inbox desde el 06-10).

create or replace function public.inbox_reply_counts(
  p_from text, p_subject text, p_in_reply_to text, p_auto text, p_lead_email text
) returns boolean language sql immutable as $$
  select
    -- Aviso de entrega fallida: no es una respuesta.
    not (
      coalesce(p_subject, '') ~* '(undeliverable|undelivered|unknown recipient|unbekannte?r? empf|delivery (status notification|failure|has failed)|mail delivery (failed|subsystem)|returned mail|non remis|no se (ha )?pudo entregar|mensaje no entregado|failure notice)'
      or coalesce(p_from, '') ~* '^(mailer-daemon|postmaster|microsoftexchange[0-9a-f]*)@'
    )
    and (
      lower(coalesce(p_from, '')) = lower(coalesce(p_lead_email, ''))
      or p_auto is not null
      or nullif(btrim(coalesce(p_in_reply_to, '')), '') is not null
      or coalesce(p_subject, '') ~* '^\s*((re|r|aw|sv|vs|rv|fw|fwd|tr|wg|antw|odp|réf|ref)\s*(\[\d+\])?\s*:|(respuesta autom|automatic reply|auto.?reply|risposta automatica|réponse automatique|automatische antwort|out of office|fuera de (la )?oficina|ausente|ausencia|abwesend))'
    );
$$;

create or replace function public.trg_inbox_mark_replied() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.lead_id is null or new.campaign_id is null
     or coalesce(new.is_sent, false) or coalesce(new.is_warmup, false) then
    return new;
  end if;
  if public.inbox_reply_counts(new.from_email, new.subject, new.in_reply_to, new.auto_signal,
       (select l.email from public.leads l where l.id = new.lead_id)) then
    update public.sent_emails s
       set replied_at = new.received_at
     where s.lead_id = new.lead_id and s.campaign_id = new.campaign_id
       and s.replied_at is null
       and coalesce(s.sent_at, s.created_at) <= new.received_at;
  end if;
  return new;
end $$;

drop trigger if exists inbox_mark_replied on public.inbox_messages;
create trigger inbox_mark_replied
  after update of lead_id, campaign_id on public.inbox_messages
  for each row
  when (new.lead_id is not null and new.campaign_id is not null
        and (old.lead_id is distinct from new.lead_id or old.campaign_id is distinct from new.campaign_id))
  execute function public.trg_inbox_mark_replied();

-- Repaso de lo que ya está enlazado.
create table if not exists public.backup_replied_at_20261007 (sent_email_id uuid primary key, marked_at timestamptz default now());

with m as (
  select distinct on (im.lead_id, im.campaign_id) im.user_id, im.lead_id, im.campaign_id, im.received_at
  from public.inbox_messages im
  join public.leads l on l.id = im.lead_id
  where im.lead_id is not null and im.campaign_id is not null
    and not coalesce(im.is_sent, false) and not coalesce(im.is_warmup, false)
    and public.inbox_reply_counts(im.from_email, im.subject, im.in_reply_to, im.auto_signal, l.email)
    and not exists (select 1 from public.sent_emails x where x.lead_id = im.lead_id and x.campaign_id = im.campaign_id and x.replied_at is not null)
  order by im.lead_id, im.campaign_id, im.received_at
), u as (
  update public.sent_emails s
     set replied_at = m.received_at
    from m
   where s.lead_id = m.lead_id and s.campaign_id = m.campaign_id
     and s.replied_at is null
     and coalesce(s.sent_at, s.created_at) <= m.received_at
  returning s.id
)
insert into public.backup_replied_at_20261007 (sent_email_id) select id from u on conflict do nothing;
