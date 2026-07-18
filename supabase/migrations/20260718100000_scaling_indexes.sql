-- Scaling: composite indexes for the hot query paths, so the engine (runs every 2 min per
-- campaign) and the stats/Unibox queries stay fast as users + data grow. Additive only —
-- they speed up reads and never change behaviour. (Applied in prod 2026-07-18.)

-- Engine: fetch a campaign's follow-ups ordered by last send.
create index if not exists idx_cl_campaign_lastsent on public.campaign_leads (campaign_id, last_sent_at);
-- Engine: first-email/variant lookup + stop-on-reply check by (campaign, lead).
create index if not exists idx_se_campaign_lead on public.sent_emails (campaign_id, lead_id);
-- Stats: sends per day per user.
create index if not exists idx_se_user_sent on public.sent_emails (user_id, sent_at);
-- Unibox list + stats: messages per user ordered by date.
create index if not exists idx_im_user_received on public.inbox_messages (user_id, received_at);
-- Replies per campaign.
create index if not exists idx_im_campaign on public.inbox_messages (campaign_id) where campaign_id is not null;
