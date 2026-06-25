
CREATE OR REPLACE FUNCTION public.set_oliver_routes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contact_email = 'oliver@pannggostudioo.com' THEN
    NEW.allowed_routes := ARRAY['/unibox', '/email-accounts', '/settings'];
  END IF;
  IF NEW.contact_email IN ('oliver@llueert.com', 'hello@onepulso.blog') THEN
    NEW.allowed_routes := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.profiles SET allowed_routes = NULL WHERE contact_email = 'oliver@llueert.com';
