-- Unibox spec alignment: folders, per-account warmup/uid/signature, message
-- warmup/folder/threading flags, richer reminders, unibox-level profile fields.
-- Idempotent (IF NOT EXISTS) to match repo style. Does NOT touch dedupe inputs.

-- 1.5 Folders (create first so inbox_messages.folder_id FK can reference it)
CREATE TABLE IF NOT EXISTS public.unibox_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.unibox_folders ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'unibox_folders'
      AND policyname = 'Users manage own folders'
  ) THEN
    CREATE POLICY "Users manage own folders" ON public.unibox_folders
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 1.1 profiles (unibox-level fields)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unibox_title  text,
  ADD COLUMN IF NOT EXISTS warmup_filter boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unibox_notes  text,
  ADD COLUMN IF NOT EXISTS last_sync     timestamptz;

-- 1.2 email_accounts (per-account spec fields)
ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS signature_html   text,
  ADD COLUMN IF NOT EXISTS warmup_limit     integer,
  ADD COLUMN IF NOT EXISTS warmup_increment integer,
  ADD COLUMN IF NOT EXISTS last_uid_inbox   bigint,
  ADD COLUMN IF NOT EXISTS last_uid_sent    bigint,
  ADD COLUMN IF NOT EXISTS last_error       text,
  ADD COLUMN IF NOT EXISTS last_sync        timestamptz,
  ADD COLUMN IF NOT EXISTS notes            text;

-- Refresh the safe view to expose the new (non-secret) columns
DROP VIEW IF EXISTS public.email_accounts_safe;
CREATE VIEW public.email_accounts_safe
WITH (security_invoker = true)
AS
SELECT
  id, user_id, email, first_name, last_name,
  imap_username, imap_host, imap_port,
  smtp_username, smtp_host, smtp_port,
  status, tags, daily_limit, sent_today,
  send_start_hour, send_end_hour,
  warmup_enabled, warmup_day,
  last_health_check, created_at, updated_at,
  signature_html, warmup_limit, warmup_increment,
  last_uid_inbox, last_uid_sent, last_error, last_sync, notes,
  '••••••••'::text AS imap_password,
  '••••••••'::text AS smtp_password
FROM public.email_accounts;
GRANT SELECT ON public.email_accounts_safe TO authenticated;

-- 1.3 inbox_messages (warmup/folder/threading). ref_chain avoids reserved word.
ALTER TABLE public.inbox_messages
  ADD COLUMN IF NOT EXISTS is_warmup   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sent     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS folder_id   uuid REFERENCES public.unibox_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS ref_chain   text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hidden_lang text;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_is_warmup ON public.inbox_messages(user_id, is_warmup);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_folder    ON public.inbox_messages(folder_id);

-- 1.4 message_reminders (extend in place with full lifecycle)
ALTER TABLE public.message_reminders
  ADD COLUMN IF NOT EXISTS recipient           text,
  ADD COLUMN IF NOT EXISTS original_subject    text,
  ADD COLUMN IF NOT EXISTS original_message_id text,
  ADD COLUMN IF NOT EXISTS original_references text,
  ADD COLUMN IF NOT EXISTS reminder_body       text,
  ADD COLUMN IF NOT EXISTS scheduled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sent_message_id     text,
  ADD COLUMN IF NOT EXISTS sent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS error               text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_reminders_status_chk'
  ) THEN
    ALTER TABLE public.message_reminders
      ADD CONSTRAINT message_reminders_status_chk
      CHECK (status IN ('pending','sent','cancelled_by_reply','cancelled','failed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON public.message_reminders(status, remind_at) WHERE status = 'pending';
