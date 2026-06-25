
CREATE OR REPLACE FUNCTION public.bulk_delete_leads(lead_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  owned_ids uuid[];
BEGIN
  -- First, determine which lead_ids the caller actually owns
  SELECT array_agg(id) INTO owned_ids
  FROM public.leads
  WHERE id = ANY(lead_ids) AND user_id = auth.uid();

  -- If none owned, exit early
  IF owned_ids IS NULL THEN
    RETURN;
  END IF;

  -- Delete from dependent tables using only owned lead ids
  DELETE FROM public.message_reminders WHERE message_id IN (
    SELECT id FROM public.inbox_messages WHERE lead_id = ANY(owned_ids)
  );
  DELETE FROM public.inbox_messages WHERE lead_id = ANY(owned_ids);
  DELETE FROM public.sent_emails WHERE lead_id = ANY(owned_ids);
  DELETE FROM public.campaign_leads WHERE lead_id = ANY(owned_ids);
  -- Finally delete leads
  DELETE FROM public.leads WHERE id = ANY(owned_ids);
END;
$function$;
