
-- 1. Fix community-media INSERT policy: scope to user's own directory
DROP POLICY IF EXISTS "Authenticated users can upload community media" ON storage.objects;
CREATE POLICY "Authenticated users can upload community media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'community-media'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

-- 2. Add UPDATE policy for godtube-media bucket
CREATE POLICY "Users can update own godtube media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'godtube-media'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

-- 3. Fix profiles UPDATE policy: restrict to safe columns only
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO public
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND coins = (SELECT p.coins FROM public.profiles p WHERE p.user_id = auth.uid())
  AND max_email_accounts IS NOT DISTINCT FROM (SELECT p.max_email_accounts FROM public.profiles p WHERE p.user_id = auth.uid())
  AND allowed_routes IS NOT DISTINCT FROM (SELECT p.allowed_routes FROM public.profiles p WHERE p.user_id = auth.uid())
);
