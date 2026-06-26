-- Global job lock so process-campaign-queue never runs concurrently with itself.
-- Prevents double-sent follow-ups and daily-limit overshoot when a run takes longer
-- than the cron interval under heavy multi-campaign load.

CREATE TABLE IF NOT EXISTS public.processing_locks (
  name text PRIMARY KEY,
  locked_until timestamptz NOT NULL
);
ALTER TABLE public.processing_locks ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role / SECURITY DEFINER functions below touch it.

-- Atomically acquire (or refresh if expired) a named lock. Returns true if acquired.
CREATE OR REPLACE FUNCTION public.acquire_job_lock(p_name text, p_ttl_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  INSERT INTO public.processing_locks (name, locked_until)
  VALUES (p_name, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (name) DO UPDATE
    SET locked_until = EXCLUDED.locked_until
    WHERE public.processing_locks.locked_until < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt > 0;
END;
$$;

-- Release a lock so the next run can acquire it immediately (TTL is the crash safety net).
CREATE OR REPLACE FUNCTION public.release_job_lock(p_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.processing_locks SET locked_until = now() WHERE name = p_name;
$$;

-- Only the backend (service role) may touch the locks — never the public/anon key.
REVOKE ALL ON FUNCTION public.acquire_job_lock(text, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job_lock(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_job_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job_lock(text) TO service_role;
