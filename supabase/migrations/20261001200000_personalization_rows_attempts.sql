-- Personalización: que ningún lead se quede en error a la primera. Si la IA falla con un lead, se
-- vuelve a intentar en las pasadas siguientes; sólo tras varios intentos queda marcado como error.
alter table public.personalization_csv_rows add column if not exists attempts integer not null default 0;
