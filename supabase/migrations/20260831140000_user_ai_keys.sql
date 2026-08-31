-- BYOK: external (non-agency) users connect their own OpenAI/DeepSeek key so their AI usage bills
-- THEIR credits. Stored service-role only and NEVER returned to the client (only a masked hint via
-- the ai-key edge fn). Agency staff + agency-created clients keep using the platform key.
create table if not exists public.user_ai_keys (
  user_id uuid primary key,
  provider text not null default 'openai',   -- 'openai' | 'deepseek'
  api_key text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.user_ai_keys enable row level security;
revoke all on public.user_ai_keys from anon, authenticated;  -- edge fn (service role) only
