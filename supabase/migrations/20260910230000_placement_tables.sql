-- Placement (Entregabilidad) tables. These were created by hand on the live database and never
-- had a migration, so a fresh environment came up without them and placement-test 500'd. This
-- reproduces the live schema exactly and is written to be a no-op where they already exist.
--
-- placement_seeds holds its OWN IMAP credentials on purpose: seed mailboxes must never live in
-- email_accounts, or fetch-inbox would sync them into the campaign Unibox.

CREATE TABLE IF NOT EXISTS public.placement_seeds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  provider text,
  imap_host text NOT NULL,
  imap_port integer DEFAULT 993,
  imap_user text NOT NULL,
  imap_pass text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT placement_seeds_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.placement_tests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  from_account_id uuid,
  from_email text,
  subject text,
  token text NOT NULL,
  seeds integer DEFAULT 0,
  inbox integer DEFAULT 0,
  spam integer DEFAULT 0,
  missing integer DEFAULT 0,
  results jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'sent'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT placement_tests_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_seeds_user ON public.placement_seeds USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_placement_user ON public.placement_tests USING btree (user_id, created_at DESC);

ALTER TABLE public.placement_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_tests ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS, so guard each one: the live DB already carries them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'seeds_own' AND polrelid = 'public.placement_seeds'::regclass) THEN
    CREATE POLICY seeds_own ON public.placement_seeds
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'placement_own' AND polrelid = 'public.placement_tests'::regclass) THEN
    CREATE POLICY placement_own ON public.placement_tests
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
