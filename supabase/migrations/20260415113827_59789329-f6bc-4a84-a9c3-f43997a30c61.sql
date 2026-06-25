
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
      coalesce(subject, '') ~ '\| ?[A-Za-z0-9_-]{5,}'
    )
  ORDER BY received_at DESC
  LIMIT _limit;
$$;
