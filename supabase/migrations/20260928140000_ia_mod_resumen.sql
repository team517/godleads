-- Memoria larga de PulseBot sin que crezca el almacenamiento: los mensajes antiguos se resumen en
-- un texto corto por cliente (resumen) y se sabe hasta dónde llega (resumen_hasta). Los mensajes que
-- ya están en el resumen se pueden borrar al pasar de 300 por cliente.
alter table public.ia_mod_notes add column if not exists resumen text not null default '';
alter table public.ia_mod_notes add column if not exists resumen_hasta timestamptz;
