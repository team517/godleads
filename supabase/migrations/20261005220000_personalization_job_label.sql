-- Personalización: una etiqueta por lista ("Lucy", "Juan software"…) para saber de quién o para
-- qué es cada una en la cola (petición del dueño, 05-10-2026). Texto libre, opcional; la escribe
-- el usuario desde la cola y la protege la misma política de la tabla (own csv personalization jobs).
alter table public.personalization_csv_jobs add column if not exists label text;

notify pgrst, 'reload schema';
