-- Versiones apagadas de un correo de la secuencia.
--
-- El motor de envío (process-campaign-queue) sólo lee `campaign_steps.variants`. Para que una
-- variante se pueda APAGAR sin perder lo escrito —y sin tocar el motor— la variante apagada se
-- guarda aquí: sigue estando, pero el motor no la ve y por tanto no la envía.
-- Cada una recuerda su hueco (off_slot: 1 = B, 2 = C…) para que al encenderla vuelva a su letra.

alter table public.campaign_steps
  add column if not exists variants_off jsonb not null default '[]'::jsonb;
