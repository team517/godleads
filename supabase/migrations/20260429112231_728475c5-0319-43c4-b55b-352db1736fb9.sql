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
    AND (
      coalesce(subject, '') ~* '^\s*(re|fw|fwd|rv|aw|tr|res)\s*:'
      OR NOT (
        coalesce(subject, '') ~ '(\m[A-Z]{2,}[0-9]+[A-Z0-9]*\M|\m[0-9]+[A-Z]{2,}[A-Z0-9]*\M)'
        OR coalesce(subject, '') ~ '\m[A-Z]{6,12}\M'
        OR coalesce(subject, '') ~* '#warmup'
      )
    )
  ORDER BY received_at DESC
  LIMIT _limit;
$function$;
