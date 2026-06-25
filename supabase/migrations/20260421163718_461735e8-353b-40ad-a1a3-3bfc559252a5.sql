-- Añadir dominios problemáticos al blocklist del usuario afectado
INSERT INTO public.blocklist (user_id, entry_type, value)
SELECT '5db694cf-5138-41f1-b1cd-a2b30ab9a0c4', 'domain', d
FROM (VALUES ('ideas4all.com'), ('opground.com'), ('proyectopublicoprim.com')) AS t(d)
WHERE NOT EXISTS (
  SELECT 1 FROM public.blocklist b
  WHERE b.user_id = '5db694cf-5138-41f1-b1cd-a2b30ab9a0c4'
    AND b.entry_type = 'domain'
    AND b.value = t.d
);

-- Detener envíos a leads de esos dominios
UPDATE public.campaign_leads cl
SET status = 'bounced'
FROM public.leads l
WHERE cl.lead_id = l.id
  AND cl.status IN ('pending', 'in_progress', 'sent')
  AND split_part(l.email, '@', 2) IN ('ideas4all.com', 'opground.com', 'proyectopublicoprim.com');

-- Marcar como bounced los fallos 451 para que no reintenten
UPDATE public.sent_emails
SET status = 'bounced', bounced_at = now()
WHERE status = 'failed'
  AND error_message LIKE '%451%'
  AND created_at > now() - interval '24 hours';