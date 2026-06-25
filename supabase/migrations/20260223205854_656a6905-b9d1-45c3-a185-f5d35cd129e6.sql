
-- Force RLS on sensitive tables so even table owners are restricted
ALTER TABLE public.email_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

-- Revoke direct access from anon and authenticated roles to be safe
-- (RLS policies will grant the correct access)
REVOKE ALL ON public.email_accounts FROM anon;
REVOKE ALL ON public.inbox_messages FROM anon;
REVOKE ALL ON public.user_roles FROM anon;
