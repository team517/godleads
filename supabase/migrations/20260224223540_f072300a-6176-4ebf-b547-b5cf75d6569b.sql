CREATE POLICY "Users can delete own community messages"
ON public.community_messages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);