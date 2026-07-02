-- Unibox English gate: return the DISTINCT set of domains that belong to the
-- caller's own leads, so English/other-foreign inbound is shown ONLY when the
-- sender's domain is a real lead domain (auth.uid-scoped, no cross-tenant read).
CREATE OR REPLACE FUNCTION public.get_lead_domains()
RETURNS TABLE(domain text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT lower(split_part(email, '@', 2)) AS domain
  FROM public.leads
  WHERE user_id = auth.uid()
    AND email LIKE '%@%';
$function$;

REVOKE ALL ON FUNCTION public.get_lead_domains() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_domains() TO authenticated;
