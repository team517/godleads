
-- 1. Remove inbox_messages from realtime publication (safe: no error if not present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inbox_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.inbox_messages;
  END IF;
END $$;

-- 2. Restrict email_accounts RLS policy to authenticated role only
DROP POLICY IF EXISTS "Users manage own email accounts" ON public.email_accounts;
CREATE POLICY "Users manage own email accounts"
  ON public.email_accounts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Restrict inbox_messages RLS policy to authenticated role only
DROP POLICY IF EXISTS "Users manage own inbox" ON public.inbox_messages;
CREATE POLICY "Users manage own inbox"
  ON public.inbox_messages
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Add DELETE policy for community-media storage bucket
CREATE POLICY "Users delete own community media"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'community-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Add UPDATE policy for community-media storage bucket
CREATE POLICY "Users update own community media"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'community-media' AND (storage.foldername(name))[1] = auth.uid()::text);
