
CREATE OR REPLACE FUNCTION public.bulk_delete_leads(lead_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete from all FK tables first
  DELETE FROM public.inbox_messages WHERE lead_id = ANY(lead_ids);
  DELETE FROM public.sent_emails WHERE lead_id = ANY(lead_ids);
  DELETE FROM public.campaign_leads WHERE lead_id = ANY(lead_ids);
  DELETE FROM public.message_reminders WHERE message_id IN (
    SELECT id FROM public.inbox_messages WHERE lead_id = ANY(lead_ids)
  );
  -- Finally delete leads
  DELETE FROM public.leads WHERE id = ANY(lead_ids) AND user_id = auth.uid();
END;
$function$;
