-- Seguimiento → "Volver a programar follow-up": el nuevo follow-up tiene que contestar al ÚLTIMO
-- que se envió (mismo hilo). send-followups ya generaba su Message-ID pero sólo lo guardaba en
-- sent_emails; ahora también en el propio follow-up. Se rellena para los ya enviados.
alter table public.follow_ups add column if not exists sent_message_id text;

update public.follow_ups f
   set sent_message_id = (
     select s.smtp_message_id from public.sent_emails s
      where s.user_id = f.owner_id and lower(s.to_email) = lower(f.contact_email)
        and s.smtp_message_id is not null
        and abs(extract(epoch from s.sent_at - f.sent_at)) < 180
      order by abs(extract(epoch from s.sent_at - f.sent_at)) limit 1)
 where f.status = 'sent' and f.sent_message_id is null;
