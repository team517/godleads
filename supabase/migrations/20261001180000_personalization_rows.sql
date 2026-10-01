-- Personalización con CSV grandes (13.000 leads): "No se pudo iniciar: Failed to fetch".
-- El trabajo guardaba TODOS los leads y TODOS los mensajes en dos celdas jsonb de una fila: había
-- que subirlos en una sola petición de 40-45 MB (la conexión la corta) y el servidor reescribía la
-- celda de resultados entera cada 5 leads. Ahora cada lead es una fila: se suben por tandas, se
-- procesan y se guardan de uno en uno. Los trabajos antiguos (storage = 'json') siguen igual.
alter table public.personalization_csv_jobs add column if not exists storage text not null default 'json';

create table if not exists public.personalization_csv_rows (
  job_id   uuid    not null references public.personalization_csv_jobs(id) on delete cascade,
  idx      integer not null,
  data     jsonb   not null,
  message  text,
  error    text,
  done     boolean not null default false,
  primary key (job_id, idx)
);
create index if not exists personalization_csv_rows_pending_idx on public.personalization_csv_rows (job_id, idx) where not done;

alter table public.personalization_csv_rows enable row level security;
drop policy if exists "personalization rows: propias" on public.personalization_csv_rows;
create policy "personalization rows: propias" on public.personalization_csv_rows for all
  using (exists (select 1 from public.personalization_csv_jobs j where j.id = job_id and j.user_id = auth.uid()))
  with check (exists (select 1 from public.personalization_csv_jobs j where j.id = job_id and j.user_id = auth.uid()));
