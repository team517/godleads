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
    -- Hide #warmup hashtag always
    AND coalesce(subject, '') !~* '#warmup'
    -- Hide warmup-tracking codes (e.g. CHBV6J7, WK2FX1R, 0BKNDHR) — these are
    -- short (5-10 char) ALL-CAPS tokens mixing letters & digits, often appended
    -- after a "|" separator. Real reply subjects almost never contain these.
    AND coalesce(subject, '') !~ '\m[A-Z0-9]{5,10}\M\s+\m[A-Z0-9]{5,10}\M'
    AND coalesce(subject, '') !~ '\|\s*\m[A-Z]*[0-9]+[A-Z0-9]*\M'
    AND coalesce(subject, '') !~ '\m[A-Z]+[0-9]+[A-Z0-9]*\M\s+\m[A-Z]+[0-9]+[A-Z0-9]*\M'
  ORDER BY received_at DESC
  LIMIT _limit;
$function$;
