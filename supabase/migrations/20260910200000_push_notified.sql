-- One row per message we have already pushed to a phone.
--
-- Until now the "Interesado" label WAS the dedupe: push-interested only notified when it was
-- the one adding the label. But the Unibox labels messages as soon as somebody looks at them,
-- so whoever opened the inbox first silently stole the notification — the alert never fired for
-- messages the browser had already classified. The dedupe has to be its own record.
CREATE TABLE IF NOT EXISTS public.push_notified (
  message_id uuid PRIMARY KEY REFERENCES public.inbox_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_notified_created ON public.push_notified (created_at);

ALTER TABLE public.push_notified ENABLE ROW LEVEL SECURITY;
-- Service role only (the cron). No client ever reads or writes this.
