-- "Crear campaña nueva" flow for EXISTING clients who email support@ asking for another
-- campaign. The bot re-sends the Google Form (no onboarding); when the form comes back the
-- agent generates the campaign as a DRAFT and notifies team@; the owner approves in the
-- platform, which sends the client the copys PDF.
create table if not exists public.new_campaign_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  client_user_id uuid,
  company_name text,
  from_email text,
  subject text,
  in_reply_to text,
  references_hdr text,
  status text default 'awaiting_form',   -- awaiting_form | pending_approval | approved | error
  campaign_id uuid,
  campaign_name text,
  form_response_id uuid,
  note text,
  requested_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists ncr_owner_status_idx on public.new_campaign_requests(owner_id, status, requested_at desc);
alter table public.new_campaign_requests enable row level security;
revoke all on public.new_campaign_requests from anon, authenticated; -- service role (agent) manages it

-- Owner reads their pending campaigns to approve (status only, no secrets).
create or replace function public.my_new_campaign_requests()
returns setof public.new_campaign_requests
language sql stable security definer set search_path to 'public' as $$
  select * from public.new_campaign_requests
  where owner_id = auth.uid() and status in ('awaiting_form','pending_approval')
  order by requested_at desc limit 50;
$$;
revoke all on function public.my_new_campaign_requests() from public, anon;
grant execute on function public.my_new_campaign_requests() to authenticated;

-- Owner marks one approved (after the frontend sends the copys email).
create or replace function public.approve_new_campaign(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.new_campaign_requests set status='approved', updated_at=now()
  where id = p_id and owner_id = auth.uid();
$$;
revoke all on function public.approve_new_campaign(uuid) from public, anon;
grant execute on function public.approve_new_campaign(uuid) to authenticated;
