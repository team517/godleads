
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
      -- Mixed letters+digits: CHBV6J7, 9TKZ8TD, CDQ0HA1
      coalesce(subject, '') ~ '(\m[A-Z]{2,}[0-9]+[A-Z0-9]*\M|\m[0-9]+[A-Z]{2,}[A-Z0-9]*\M)'
      -- All-uppercase non-word codes 6+ chars: PFXYSJH, FETREG, SRCFJWH
      OR coalesce(subject, '') ~ '\m[A-Z]{6,12}\M'
      -- Warmup hashtag
      OR coalesce(subject, '') ~* '#warmup'
    )
  ORDER BY received_at DESC
  LIMIT _limit;
$$;
