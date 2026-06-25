
-- GodTube channels
CREATE TABLE public.godtube_channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  channel_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  banner_url TEXT,
  is_official BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT godtube_channels_user_id_unique UNIQUE (user_id)
);

-- GodTube videos
CREATE TABLE public.godtube_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.godtube_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.godtube_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.godtube_videos ENABLE ROW LEVEL SECURITY;

-- Channels: everyone can read
CREATE POLICY "Anyone can read channels" ON public.godtube_channels FOR SELECT USING (true);
CREATE POLICY "Users manage own channel" ON public.godtube_channels FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own channel" ON public.godtube_channels FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own channel" ON public.godtube_channels FOR DELETE USING (auth.uid() = user_id);

-- Videos: everyone can read
CREATE POLICY "Anyone can read videos" ON public.godtube_videos FOR SELECT USING (true);
CREATE POLICY "Users manage own videos" ON public.godtube_videos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own videos" ON public.godtube_videos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own videos" ON public.godtube_videos FOR DELETE USING (auth.uid() = user_id);

-- Increment views function
CREATE OR REPLACE FUNCTION public.increment_video_views(video_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.godtube_videos SET views = views + 1 WHERE id = video_id;
END;
$$;

-- Updated_at trigger for channels
CREATE TRIGGER update_godtube_channels_updated_at
  BEFORE UPDATE ON public.godtube_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.godtube_channels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.godtube_videos;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('godtube-media', 'godtube-media', true);

-- Storage policies
CREATE POLICY "Anyone can read godtube media" ON storage.objects FOR SELECT USING (bucket_id = 'godtube-media');
CREATE POLICY "Authenticated users upload godtube media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'godtube-media' AND auth.role() = 'authenticated');
CREATE POLICY "Users delete own godtube media" ON storage.objects FOR DELETE USING (bucket_id = 'godtube-media' AND auth.uid()::text = (storage.foldername(name))[1]);
