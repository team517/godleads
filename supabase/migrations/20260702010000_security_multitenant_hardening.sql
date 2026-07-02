-- Multi-tenant security hardening (audit 2026-07-02).
-- Closes cross-tenant leaks so no user can read another user's data ("que no se mezcle nada").

-- 1) get_inbox_nonwarmup: was SECURITY DEFINER filtering on the caller-supplied
--    _user_id with NO auth.uid() check → any logged-in user could read ANY other
--    tenant's entire Unibox. Add an ownership guard.
CREATE OR REPLACE FUNCTION public.get_inbox_nonwarmup(_user_id uuid, _limit integer DEFAULT 1000)
RETURNS SETOF public.inbox_messages
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT *
  FROM public.inbox_messages
  WHERE user_id = _user_id
    AND _user_id = auth.uid()          -- ownership guard: only your own inbox
    AND is_archived = false
  ORDER BY received_at DESC
  LIMIT _limit;
$function$;

-- 2) admin_lead_counts / admin_account_counts: SECURITY DEFINER aggregates across
--    ALL users. They were EXECUTE-able by PUBLIC (anon + authenticated), leaking every
--    tenant's user_id + row counts. Restrict to service_role (the admin edge function).
REVOKE ALL ON FUNCTION public.admin_lead_counts()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_account_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lead_counts()    TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_account_counts() TO service_role;
