
-- Helper functions for admin panel (security definer, only callable by service role)
CREATE OR REPLACE FUNCTION public.admin_lead_counts()
RETURNS TABLE(user_id uuid, count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT user_id, COUNT(*) as count FROM public.leads GROUP BY user_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_account_counts()
RETURNS TABLE(user_id uuid, count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT user_id, COUNT(*) as count FROM public.email_accounts GROUP BY user_id;
$$;
