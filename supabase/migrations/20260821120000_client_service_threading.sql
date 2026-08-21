-- Threading + safe claiming for the customer-service agent.
--
-- thread_msg_id / thread_refs: the Message-ID and References chain of the email the agent
-- already sent. A deferred follow-up ("ya está aplicado", the copys PDF) replies against
-- them, so the client sees ONE conversation instead of a pile of loose emails.
--
-- claimed_at: a pending delivery is claimed before it is sent, so two overlapping cron ticks
-- can't send it twice. A claim older than 5 minutes is treated as stale and retried, so a
-- crash mid-send never loses a delivery.
alter table public.client_service_log
  add column if not exists thread_msg_id text,
  add column if not exists thread_refs   text,
  add column if not exists claimed_at    timestamptz;

-- The pending scan orders by created_at and now also reads the claim.
drop index if exists client_service_log_pending_idx;
create index if not exists client_service_log_pending_idx
  on public.client_service_log(owner_id, created_at, claimed_at) where pending;
