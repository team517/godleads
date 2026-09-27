-- Modificaciones IA: archivos CSV adjuntos en el chat (leads y demás tablas).
--
-- El navegador lee el CSV, lo limpia y lo sube por trozos (ia_mod_upload_append) para no mandar
-- un cuerpo enorme de una vez. PulseBot sólo ve un resumen y las filas que pide; importar leads a
-- una campaña pasa siempre por "Confirmar" (ia_mod_changes, kind leads_import) y se puede deshacer.
-- Sin policies: sólo el service role (edge function ia-modificaciones).

create table if not exists public.ia_mod_uploads (
  id              uuid primary key default gen_random_uuid(),
  client_user_id  uuid not null references auth.users(id) on delete cascade,
  author_email    text,
  filename        text not null default 'archivo.csv',
  kind            text not null default 'leads' check (kind in ('leads', 'tabla')),
  headers         jsonb not null default '[]'::jsonb,
  rows            jsonb not null default '[]'::jsonb,
  row_count       int  not null default 0,
  expected_rows   int  not null default 0,
  discarded       int  not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists ia_mod_uploads_client_idx on public.ia_mod_uploads (client_user_id, created_at desc);
alter table public.ia_mod_uploads enable row level security;

-- Añadir un trozo de filas a un adjunto (máx. 25.000 filas por archivo).
create or replace function public.ia_mod_upload_append(p_id uuid, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'filas no válidas'; end if;
  update ia_mod_uploads
     set rows = rows || p_rows,
         row_count = jsonb_array_length(rows || p_rows)
   where id = p_id
     and row_count + jsonb_array_length(p_rows) <= 25000
  returning row_count into n;
  if n is null then raise exception 'adjunto no encontrado o demasiado grande (máx. 25.000 filas)'; end if;
  return n;
end;
$$;

revoke all on function public.ia_mod_upload_append(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ia_mod_upload_append(uuid, jsonb) to service_role;
