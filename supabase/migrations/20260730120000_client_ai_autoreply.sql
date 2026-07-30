-- Per-client AI auto-reply assistant config.
-- The owner writes a SAVED prompt per client (tone + knowledge), an optional
-- meeting/calendar link, and toggles the assistant on. The auto-reply engine
-- (phase 2) reads these to answer inbound mail on that client's connected
-- accounts: it identifies the client by the receiving account, feeds the prompt
-- + the client's campaign context, and — in 'rules' mode — auto-sends a reply to
-- a clear question or meeting request (sharing the calendar link) while leaving
-- anything negative/ambiguous as a DRAFT for review.
alter table public.profiles
  add column if not exists ai_reply_enabled      boolean not null default false,
  add column if not exists ai_reply_prompt        text,
  add column if not exists ai_reply_calendar_url  text,
  -- 'rules' = auto-send clear questions + meeting requests, draft the rest.
  -- 'draft' = never auto-send (always leave a draft). 'auto' = always send.
  add column if not exists ai_reply_mode          text not null default 'rules';
