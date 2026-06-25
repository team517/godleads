
-- Add thread support to community_messages
ALTER TABLE public.community_messages ADD COLUMN thread_id uuid REFERENCES public.community_messages(id) ON DELETE CASCADE DEFAULT NULL;
ALTER TABLE public.community_messages ADD COLUMN reply_count integer NOT NULL DEFAULT 0;

-- Index for fast thread queries
CREATE INDEX idx_community_messages_thread_id ON public.community_messages(thread_id);
