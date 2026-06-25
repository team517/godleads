
-- Blocklist table for emails and domains
CREATE TABLE public.blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entry_type text NOT NULL DEFAULT 'email', -- 'email' or 'domain'
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, entry_type, value)
);

ALTER TABLE public.blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blocklist"
  ON public.blocklist FOR ALL
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
