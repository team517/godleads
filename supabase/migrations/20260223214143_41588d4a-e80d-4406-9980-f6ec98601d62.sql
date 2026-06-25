
-- Add notification preference column
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS notify_interested boolean NOT NULL DEFAULT false;

-- Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create trigger function that calls the edge function when an interested message arrives
CREATE OR REPLACE FUNCTION public.notify_on_interested_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _notify boolean;
  _supabase_url text;
  _anon_key text;
BEGIN
  -- Only fire if the message has 'Interesado' label
  IF NEW.labels IS NULL OR NOT ('Interesado' = ANY(NEW.labels)) THEN
    RETURN NEW;
  END IF;

  -- Check if user has notifications enabled
  SELECT notify_interested INTO _notify
  FROM public.profiles
  WHERE user_id = NEW.user_id
  LIMIT 1;

  IF _notify IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Get Supabase URL and anon key from vault or hardcode project ref
  PERFORM extensions.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/notify-interested',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8'
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'from_email', NEW.from_email,
      'from_name', COALESCE(NEW.from_name, NEW.from_email),
      'subject', COALESCE(NEW.subject, '(sin asunto)'),
      'message_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on inbox_messages
DROP TRIGGER IF EXISTS trg_notify_interested ON public.inbox_messages;
CREATE TRIGGER trg_notify_interested
  AFTER INSERT ON public.inbox_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_interested_message();
