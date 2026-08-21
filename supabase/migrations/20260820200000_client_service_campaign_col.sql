-- For "send_copys_later": remember which campaign (if any) to deliver when the queued copys
-- PDF is built on a later run. Null = all campaigns.
alter table public.client_service_log add column if not exists campaign text;
