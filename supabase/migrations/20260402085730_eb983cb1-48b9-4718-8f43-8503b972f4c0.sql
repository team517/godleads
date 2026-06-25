CREATE OR REPLACE FUNCTION public.set_oliver_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contact_email IN ('oliver@llueert.com', 'hello@onepulso.blog', 'oliver@pannggostudioo.com', 'rk@coldabry.com', 'oliver@osakaadigital.com') THEN
    NEW.allowed_routes := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.profiles SET allowed_routes = NULL WHERE contact_email = 'oliver@osakaadigital.com';