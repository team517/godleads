-- Destinatarios del correo recibido: "Para" y "Cc".
-- 24-09-2026: una respuesta de Alimentos Delcasino sumaba a un compañero como segundo
-- destinatario ("ANDRES LOSADA <andreslostor@gmail.com>") y en el Unibox no se veía por ningún
-- lado, así que parecía que escribían sólo a nuestro buzón. Ahora se guardan al sincronizar.
alter table public.inbox_messages add column if not exists to_emails text;
alter table public.inbox_messages add column if not exists cc_emails text;
comment on column public.inbox_messages.to_emails is 'Cabecera To tal cual (nombres + direcciones), recortada a 2000 caracteres.';
comment on column public.inbox_messages.cc_emails is 'Cabecera Cc tal cual (nombres + direcciones), recortada a 2000 caracteres.';
