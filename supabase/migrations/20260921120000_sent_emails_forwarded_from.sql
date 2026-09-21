-- Un reenvío recuerda DE QUÉ mensaje del Unibox salió.
--
-- Hasta ahora un reenvío a un tercero (p. ej. a un compañero) se guardaba en sent_emails sólo con
-- el destinatario, así que la conversación original no tenía forma de enseñarlo: el hilo de un
-- contacto sólo mira lo enviado A ESE contacto. Con esta columna el hilo puede incluir también
-- "lo que reenviaste de aquí", y el reenvío y el original quedan juntos.

alter table public.sent_emails
  add column if not exists forwarded_from uuid;

create index if not exists sent_emails_forwarded_from_idx
  on public.sent_emails (forwarded_from)
  where forwarded_from is not null;
