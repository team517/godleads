-- Server-side personalization jobs so generation keeps running even if the user
-- closes the tab / turns off the PC. A cron processes each job in chunks; the
-- frontend just creates the job and polls its progress.
CREATE TABLE IF NOT EXISTS public.personalization_csv_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename     text,
  prompt       text NOT NULL,
  provider     text NOT NULL DEFAULT 'deepseek',
  email_column text,
  columns      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ordered column names
  rows         jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{__idx, col:val, ...}]
  results      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { "<idx>": {message, error} }
  status       text NOT NULL DEFAULT 'pending',       -- pending / running / completed / error
  total        int  NOT NULL DEFAULT 0,
  done         int  NOT NULL DEFAULT 0,
  ok           int  NOT NULL DEFAULT 0,
  failed       int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personalization_csv_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own csv personalization jobs" ON public.personalization_csv_jobs;
CREATE POLICY "own csv personalization jobs" ON public.personalization_csv_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pcj_status_updated ON public.personalization_csv_jobs (status, updated_at);

-- Cron: process personalization jobs every minute (chunked + resumable → survives a
-- server restart or a stalled chunk; a 'running' job idle >90s is re-picked).
DO $$ BEGIN PERFORM cron.unschedule('process-personalization-every-1-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'process-personalization-every-1-min',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/process-personalization',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
