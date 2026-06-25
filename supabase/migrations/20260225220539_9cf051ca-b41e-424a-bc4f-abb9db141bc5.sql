
-- auto_reply_rules table
CREATE TABLE public.auto_reply_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  prompt text NOT NULL DEFAULT '',
  company_info text NOT NULL DEFAULT '',
  account_tags text[] NOT NULL DEFAULT '{}',
  account_ids uuid[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT false,
  delay_minutes integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_reply_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own auto_reply_rules"
  ON public.auto_reply_rules FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- auto_reply_log table
CREATE TABLE public.auto_reply_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  rule_id uuid REFERENCES public.auto_reply_rules(id) ON DELETE SET NULL,
  inbox_message_id uuid REFERENCES public.inbox_messages(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  subject text NOT NULL DEFAULT '',
  ai_response text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

ALTER TABLE public.auto_reply_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own auto_reply_log"
  ON public.auto_reply_log FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for auto_reply_log
ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_reply_log;

-- Add auto_replied column to inbox_messages
ALTER TABLE public.inbox_messages ADD COLUMN auto_replied boolean NOT NULL DEFAULT false;

-- Updated_at trigger for auto_reply_rules
CREATE TRIGGER update_auto_reply_rules_updated_at
  BEFORE UPDATE ON public.auto_reply_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
