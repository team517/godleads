CREATE OR REPLACE FUNCTION public.get_inbox_nonwarmup(_user_id uuid, _limit integer DEFAULT 1000)
 RETURNS SETOF inbox_messages
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT *
  FROM public.inbox_messages
  WHERE user_id = _user_id
    AND is_archived = false
    AND from_email NOT SIMILAR TO '%(noreply@|no-reply@|mailer-daemon@|postmaster@|bounce@)%'
    AND coalesce(subject, '') !~* '#warmup'
    AND coalesce(subject, '') !~* 'instantly-warmup'
    -- Anything with a "|" separator near the end followed by short tokens is a warmup tracking marker
    AND coalesce(subject, '') !~ '\|[^\|]{1,40}$'
    -- Also catch cases where the warmup code appears at end without "|"
    AND coalesce(subject, '') !~ '\m[A-Z]{3,}[0-9]+[A-Z0-9]*\M\s*$'
    AND coalesce(subject, '') !~ '\m[0-9]+[A-Z]{3,}[A-Z0-9]*\M\s*$'
  ORDER BY received_at DESC
  LIMIT _limit;
$function$;