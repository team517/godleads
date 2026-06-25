-- Set allowed_routes for oliver@llueert.com once they sign up (via trigger)
CREATE OR REPLACE FUNCTION public.set_oliver_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.contact_email = 'oliver@llueert.com' THEN
    NEW.allowed_routes := ARRAY['/unibox', '/email-accounts', '/settings'];
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_oliver_routes
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_oliver_routes();
