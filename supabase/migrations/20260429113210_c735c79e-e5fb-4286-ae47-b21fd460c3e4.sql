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
    -- Hide warmup-tracking codes appended after "|": "| CHBV6J7" or "| 9XAT619 CHBV6J7"
    AND coalesce(subject, '') !~ '\|\s*[A-Z0-9]*[0-9]+[A-Z0-9]*\s*([A-Z0-9]*[0-9]+[A-Z0-9]*\s*)?$'
    -- Hide subjects ending with one or two ALL-CAPS alphanumeric codes (5-10 chars with digits)
    AND coalesce(subject, '') !~ '\m[A-Z0-9]*[0-9]+[A-Z0-9]*\M\s+\m[A-Z0-9]*[0-9]+[A-Z0-9]*\M\s*$'
  ORDER BY received_at DESC
  LIMIT _limit;
$function$;