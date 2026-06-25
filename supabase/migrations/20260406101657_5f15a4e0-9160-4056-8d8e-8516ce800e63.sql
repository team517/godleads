CREATE TABLE IF NOT EXISTS public.verification_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  campaign_id UUID NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  list_id UUID NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  valid INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  risky INTEGER NOT NULL DEFAULT 0,
  required_coins INTEGER NOT NULL DEFAULT 0,
  notify_email TEXT NULL,
  error_message TEXT NULL,
  started_at TIMESTAMP WITH TIME ZONE NULL,
  completed_at TIMESTAMP WITH TIME ZONE NULL,
  last_heartbeat_at TIMESTAMP WITH TIME ZONE NULL,
  notification_sent_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_user_status_created
  ON public.verification_jobs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_campaign_status
  ON public.verification_jobs (campaign_id, status, created_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_jobs_list_status
  ON public.verification_jobs (list_id, status, created_at DESC)
  WHERE list_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_jobs_active_scope
  ON public.verification_jobs (
    user_id,
    scope,
    coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(list_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('queued', 'processing');

ALTER TABLE public.verification_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own verification jobs"
ON public.verification_jobs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own verification jobs"
ON public.verification_jobs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_next_verification_job()
RETURNS public.verification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_job public.verification_jobs;
BEGIN
  WITH next_job AS (
    SELECT v.id
    FROM public.verification_jobs v
    WHERE v.status = 'queued'
       OR (v.status = 'processing' AND v.last_heartbeat_at < now() - interval '5 minutes')
    ORDER BY v.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.verification_jobs v
  SET status = 'processing',
      started_at = COALESCE(v.started_at, now()),
      last_heartbeat_at = now(),
      updated_at = now()
  FROM next_job
  WHERE v.id = next_job.id
  RETURNING v.* INTO claimed_job;

  RETURN claimed_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_verification_job(_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.verification_jobs
  SET last_heartbeat_at = now(),
      updated_at = now()
  WHERE id = _job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_verification_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_verification_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_verification_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_verification_job(UUID) TO service_role;

DROP TRIGGER IF EXISTS update_verification_jobs_updated_at ON public.verification_jobs;
CREATE TRIGGER update_verification_jobs_updated_at
BEFORE UPDATE ON public.verification_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'verification_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.verification_jobs;
  END IF;
END $$;
