ALTER TABLE public.profiles ALTER COLUMN trial_started_at DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN trial_started_at DROP DEFAULT;
UPDATE public.profiles SET trial_started_at = NULL;
