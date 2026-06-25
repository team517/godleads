ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_days text[] DEFAULT ARRAY['mon','tue','wed','thu','fri'];
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stop_on_reply boolean DEFAULT true;
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb;
