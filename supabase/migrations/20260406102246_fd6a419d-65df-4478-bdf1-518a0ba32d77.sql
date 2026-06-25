CREATE POLICY "Users can update own verification jobs"
ON public.verification_jobs
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);