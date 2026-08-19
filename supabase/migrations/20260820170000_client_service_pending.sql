-- Two-step copy-change confirmations: after applying a copy change the agent sends a quick
-- ack, and queues the "ya está aplicado, puedes verlo" confirmation to go out on a LATER run
-- (so the client gets two naturally-separated emails, not two at once).
alter table public.client_service_log add column if not exists pending boolean default false;
alter table public.client_service_log add column if not exists subject text;
create index if not exists client_service_log_pending_idx on public.client_service_log(owner_id, pending, created_at) where pending;
