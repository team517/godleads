
-- Table to track personalization jobs running server-side
CREATE TABLE public.personalization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  selected_fields text[] NOT NULL DEFAULT '{}',
  column_name text NOT NULL,
  lead_ids uuid[] NOT NULL DEFAULT '{}',
  total integer NOT NULL DEFAULT 0,
  completed integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.personalization_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own personalization jobs"
ON public.personalization_jobs FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_personalization_jobs_updated_at
BEFORE UPDATE ON public.personalization_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
