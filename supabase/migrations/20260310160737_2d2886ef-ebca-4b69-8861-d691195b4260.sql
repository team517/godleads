ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allowed_routes text[] DEFAULT NULL;
