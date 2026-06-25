
-- Community messages table
CREATE TABLE public.community_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  content text DEFAULT '',
  message_type text NOT NULL DEFAULT 'text',
  template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  template_snapshot jsonb,
  media_url text,
  moderation_status text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read non-blocked messages
CREATE POLICY "Authenticated users can read community messages"
ON public.community_messages FOR SELECT TO authenticated
USING (moderation_status != 'blocked' OR user_id = auth.uid());

-- Users can insert their own messages
CREATE POLICY "Users can insert own community messages"
ON public.community_messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own messages (for moderation status updates via edge function)
CREATE POLICY "Users can update own community messages"
ON public.community_messages FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

-- Admins can delete any message
CREATE POLICY "Admins can delete community messages"
ON public.community_messages FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_messages;

-- Storage bucket for community media
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('community-media', 'community-media', true, 10485760);

-- Storage policies
CREATE POLICY "Authenticated users can upload community media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'community-media');

CREATE POLICY "Anyone can read community media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'community-media');
