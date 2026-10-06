-- Auditoría 06-10-2026 (#2, P1): los adjuntos de los pasos de campaña vivían en el bucket PÚBLICO
-- `godtube-media` (campaign-attachments/<campaña>/<paso>/<uuid>-<nombre>): cualquiera podía listarlos
-- y descargarlos. Bucket PRIVADO nuevo `campaign-attachments`, con la ruta
--   <user_id>/<campaña>/<paso>/<uuid>-<nombre>
-- y políticas que sólo dejan a cada usuario tocar lo que cuelga de su propia carpeta (auth.uid()).
-- El motor (service role) salta RLS y lo lee igual.

insert into storage.buckets (id, name, public, file_size_limit)
values ('campaign-attachments', 'campaign-attachments', false, 8388608)
on conflict (id) do nothing;

drop policy if exists "campaign attachments: owner insert" on storage.objects;
create policy "campaign attachments: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campaign-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "campaign attachments: owner select" on storage.objects;
create policy "campaign attachments: owner select" on storage.objects
  for select to authenticated
  using (bucket_id = 'campaign-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "campaign attachments: owner update" on storage.objects;
create policy "campaign attachments: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'campaign-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'campaign-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "campaign attachments: owner delete" on storage.objects;
create policy "campaign attachments: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'campaign-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
