REVOKE ALL ON FUNCTION public.get_inbox_nonwarmup(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inbox_nonwarmup(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inbox_nonwarmup(uuid, integer) TO authenticated;