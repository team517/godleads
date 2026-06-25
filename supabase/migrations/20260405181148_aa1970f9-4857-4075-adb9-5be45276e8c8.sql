ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS is_campaign_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_user_campaign_only_created
ON public.leads (user_id, is_campaign_only, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_user_campaign_only_list
ON public.leads (user_id, is_campaign_only, list_id);
