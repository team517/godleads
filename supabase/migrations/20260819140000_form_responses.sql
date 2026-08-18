-- Form responses via a lightweight webhook (Google Apps Script on the chosen form POSTs
-- each submission here). No OAuth, no secrets — a per-owner random key in the URL maps
-- the submission to the owner. Isolated from the sending engine.

create table if not exists public.form_webhooks (
  owner_id uuid primary key,
  key uuid not null default gen_random_uuid(),
  created_at timestamptz default now()
);
create unique index if not exists form_webhooks_key_idx on public.form_webhooks(key);
alter table public.form_webhooks enable row level security;
revoke all on public.form_webhooks from anon, authenticated;  -- key handed out via RPC only

create table if not exists public.form_responses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  form_id text,
  form_title text,
  respondent_email text,
  answers jsonb,
  raw jsonb,
  processed boolean default false,
  received_at timestamptz default now()
);
create index if not exists form_responses_owner_idx on public.form_responses(owner_id, received_at desc);
alter table public.form_responses enable row level security;
revoke all on public.form_responses from anon;
drop policy if exists fr_owner_sel on public.form_responses;
create policy fr_owner_sel on public.form_responses for select to authenticated using (owner_id = auth.uid());
grant select on public.form_responses to authenticated;

-- Returns the current owner's webhook key, creating it on first call.
create or replace function public.my_form_webhook()
returns table(key uuid)
language plpgsql volatile security definer set search_path to 'public' as $$
begin
  insert into public.form_webhooks(owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  return query select fw.key from public.form_webhooks fw where fw.owner_id = auth.uid();
end; $$;
revoke all on function public.my_form_webhook() from public, anon;
grant execute on function public.my_form_webhook() to authenticated;
