-- Personalización de listas (13-11-2026): la lista entera se paga al empezar (0,75 monedas por lead) y,
-- al acabar o pararla, se devuelve lo que no salió bien. Se anota aquí para no cobrar ni devolver dos veces.
alter table public.personalization_csv_jobs
  add column if not exists coins_charged integer,          -- monedas cobradas por adelantado (null = aún no)
  add column if not exists coins_ok_base integer,          -- leads ya bien hechos cuando se cobró
  add column if not exists coins_settled boolean not null default false;  -- ya se devolvió lo sobrante
