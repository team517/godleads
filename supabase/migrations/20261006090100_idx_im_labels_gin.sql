-- Starred / labels in the Unibox: labels @> '{Importante}' without walking all of the user's messages.
-- CONCURRENTLY: it does not block the sync's writes.
create index concurrently if not exists idx_im_labels_gin on public.inbox_messages using gin (labels);
