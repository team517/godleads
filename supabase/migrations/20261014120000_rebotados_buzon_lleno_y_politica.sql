-- "Rebotados" = sólo direcciones que no existen (14-10-2026, revisando la campaña de Ray).
-- Seguían contando como rebote, y la dirección SÍ existe:
--   · buzón lleno / sin espacio (5.2.2, "over quota", "mailbox full")
--   · buzón o grupo que sólo admite remitentes internos (Microsoft 5.7.129 / 5.7.133 / 5.7.134)
--   · filtro del destinatario que rechaza al REMITENTE ("Sender unknown", Sophos XGEMAIL_00xx,
--     "your access to submit messages … rejected")
-- 128 de 8.771 rebotes de los últimos 60 días en toda la plataforma. Siguen en el desglose del
-- tooltip; sólo dejan de sumar en la columna.
create or replace function public.bounce_is_lead_fault(p_error text)
returns boolean
language sql immutable
set search_path to 'public'
as $$
  select not (coalesce(p_error, '') ~* (
    'spamhaus|sp ?amhaus|blocked using|block ?list|black ?list|\mrbl\M|dnsbl|reputation|mout-xforward'
    || '|client host|banned|barracuda|sorbs|spamcop|uceprotect|listed (at|in|on|by) '
    || '|hop count exceeded|mail loop|tenantinboundattribution|restrictdomainstoipaddresses'
    || '|external forwarding|unable to ?receive|policy|block ?ed\)'
    || '|sender unknown|sendernotauthenticated|restrictedtorecipientspermission|access to submit messages'
    || '|xgemail|over ?quota|quota exceeded|mailbox (is )?full|insufficient (system )?storage|\m5\.2\.2\M'));
$$;
