-- Make new Unibox messages appear INSTANTLY (no manual refresh). The Unibox already
-- subscribes to realtime changes on inbox_messages (channel "unibox-realtime"), but the
-- table was not in the supabase_realtime publication, so no events were delivered and the
-- list only refreshed via the 2-minute polling fallback. Adding it delivers insert events
-- → the list reloads within seconds of a reply arriving. RLS still applies, so a user only
-- receives events for their own rows.
alter publication supabase_realtime add table public.inbox_messages;
