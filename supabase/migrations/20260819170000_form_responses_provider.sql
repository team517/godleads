-- Allow storing Google Forms API responses (deduped by the provider's responseId) in the
-- same form_responses table used by the webhook. Nulls stay distinct so webhook rows are
-- unaffected.
alter table public.form_responses add column if not exists provider_response_id text;
create unique index if not exists form_responses_provider_uidx
  on public.form_responses(owner_id, form_id, provider_response_id);
