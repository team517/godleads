CREATE OR REPLACE FUNCTION public.set_oliver_routes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contact_email IN ('oliver@llueert.com', 'hello@onepulso.blog', 'oliver@pannggostudioo.com', 'rk@coldabry') THEN
    NEW.allowed_routes := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
