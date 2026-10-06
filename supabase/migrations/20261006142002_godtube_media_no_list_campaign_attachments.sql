-- Auditoría 06-10-2026 (#2, parte 2): la política "Anyone can read godtube media" (SELECT, rol public)
-- dejaba a CUALQUIERA (incluido anon) LISTAR todo el bucket godtube-media por la API de Storage, y con
-- ello descubrir los adjuntos antiguos de campañas (prefijo campaign-attachments/).
--
-- Se excluye ese prefijo de la lectura pública y se deja a cada dueño leer los suyos (para que la
-- vista previa / el correo de prueba del editor siga pudiendo descargarlos mientras no se migren al
-- bucket privado). El resto de godtube-media (logos, vídeos, miniaturas) queda como estaba.
--
-- LÍMITE: en un bucket público la descarga por URL directa (/object/public/godtube-media/<ruta>) NO pasa
-- por estas políticas y sigue abierta para quien conozca la ruta completa (lleva dos uuid, no se adivina,
-- pero ya no se puede listar). Sólo se cierra del todo moviendo los ficheros al bucket privado.

drop policy if exists "Anyone can read godtube media" on storage.objects;
create policy "Anyone can read godtube media" on storage.objects
  for select to public
  using (
    bucket_id = 'godtube-media'
    and (storage.foldername(name))[1] is distinct from 'campaign-attachments'
  );

drop policy if exists "Owners read legacy campaign attachments" on storage.objects;
create policy "Owners read legacy campaign attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'godtube-media'
    and (storage.foldername(name))[1] = 'campaign-attachments'
    and exists (
      select 1 from public.campaigns c
       where c.id::text = (storage.foldername(name))[2]
         and c.user_id = auth.uid()
    )
  );
