-- The owner must read the CLIENT's generated campaign steps to build the copys PDF on approval,
-- but those rows belong to the client (RLS blocks a direct read). This security-definer RPC
-- returns them only for a campaign that is linked to a new_campaign_request the owner owns.
create or replace function public.new_campaign_steps(p_campaign_id uuid)
returns table(step_order int, subject text, body text, variants jsonb, delay_days int)
language sql stable security definer set search_path to 'public' as $$
  select s.step_order, s.subject, s.body, s.variants, s.delay_days
  from public.campaign_steps s
  where s.campaign_id = p_campaign_id
    and exists (select 1 from public.new_campaign_requests r where r.campaign_id = p_campaign_id and r.owner_id = auth.uid())
  order by s.step_order;
$$;
revoke all on function public.new_campaign_steps(uuid) from public, anon;
grant execute on function public.new_campaign_steps(uuid) to authenticated;

-- Show generating + error states in the flow too (not just awaiting_form / pending_approval).
create or replace function public.my_new_campaign_requests()
returns setof public.new_campaign_requests
language sql stable security definer set search_path to 'public' as $$
  select * from public.new_campaign_requests
  where owner_id = auth.uid() and status in ('awaiting_form','generating','pending_approval','error')
  order by requested_at desc limit 50;
$$;
revoke all on function public.my_new_campaign_requests() from public, anon;
grant execute on function public.my_new_campaign_requests() to authenticated;
