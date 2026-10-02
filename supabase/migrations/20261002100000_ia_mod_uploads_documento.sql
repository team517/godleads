-- Modificaciones IA: adjuntar PDF en el chat de PulseBot. El texto del PDF se lee en el navegador
-- y se guarda como un adjunto de tipo "documento": cada fila es una página ({ pagina, texto }).
alter table public.ia_mod_uploads drop constraint if exists ia_mod_uploads_kind_check;
alter table public.ia_mod_uploads add constraint ia_mod_uploads_kind_check check (kind in ('leads', 'tabla', 'documento'));
