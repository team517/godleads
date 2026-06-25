
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_user_id_list_id ON public.leads(user_id, list_id);
CREATE INDEX IF NOT EXISTS idx_leads_user_id_email ON public.leads(user_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_user_id_verification ON public.leads(user_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_leads_user_id_created ON public.leads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_id ON public.campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead_id ON public.campaign_leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_lead ON public.campaign_leads(campaign_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_lead_id ON public.sent_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_campaign_id ON public.sent_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_user_id ON public.sent_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_user_id ON public.inbox_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_lead_id ON public.inbox_messages(lead_id);
