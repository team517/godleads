ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS slow_ramp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slow_ramp_max integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS slow_ramp_increment integer NOT NULL DEFAULT 2;