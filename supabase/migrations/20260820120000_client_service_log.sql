-- Conversation memory for the customer-service agent: what each client wrote and what the
-- agent replied/did, so it has full context and NEVER repeats an answer.
create table if not exists public.client_service_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  client_user_id uuid,
  from_email text,
  action text,
  inbound text,
  reply text,
  created_at timestamptz default now()
);
create index if not exists client_service_log_client_idx on public.client_service_log(client_user_id, created_at desc);
alter table public.client_service_log enable row level security;
revoke all on public.client_service_log from anon, authenticated; -- service role (the agent) only
