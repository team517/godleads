-- Set allowed_routes for existing oliver@llueert.com user
DO $$
DECLARE
  target_user_id uuid;
BEGIN
  SELECT id INTO target_user_id FROM auth.users WHERE email = 'oliver@llueert.com';
  
  IF target_user_id IS NOT NULL THEN
    -- Confirm email
    UPDATE auth.users SET email_confirmed_at = now() WHERE id = target_user_id AND email_confirmed_at IS NULL;
    
    -- Update password
    UPDATE auth.users SET encrypted_password = crypt('OnePulso123%', gen_salt('bf')) WHERE id = target_user_id;
    
    -- Set allowed_routes on profile
    UPDATE public.profiles 
    SET allowed_routes = ARRAY['/unibox', '/email-accounts', '/settings']
    WHERE user_id = target_user_id;
  END IF;
END;
$$;
