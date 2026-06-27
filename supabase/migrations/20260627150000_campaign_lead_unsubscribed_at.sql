-- Record when a lead unsubscribed, so each campaign can list its opt-outs with a date.
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;
