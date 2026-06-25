
CREATE OR REPLACE FUNCTION public.get_inbox_nonwarmup(_user_id uuid, _limit int DEFAULT 1000)
RETURNS SETOF inbox_messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT *
  FROM public.inbox_messages
  WHERE user_id = _user_id
    AND is_archived = false
    AND from_email NOT SIMILAR TO '%(noreply@|no-reply@|mailer-daemon@|postmaster@|bounce@)%'
    AND NOT (
      -- Detect warmup codes: 5-12 char tokens with mixed letters+digits like CHBV6J7, 9TKZ8TD
      coalesce(subject, '') ~ '(\m[A-Z]{2,}[0-9]+[A-Z0-9]*\M|\m[0-9]+[A-Z]{2,}[A-Z0-9]*\M)'
    )
  ORDER BY received_at DESC
  LIMIT _limit;
$$;
