CREATE OR REPLACE FUNCTION public.set_oliver_routes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contact_email IN ('oliver@llueert.com', 'oliver@pannggostudioo.com') THEN
    NEW.allowed_routes := ARRAY['/unibox', '/email-accounts', '/settings'];
  END IF;
  RETURN NEW;
END;
$function$;
