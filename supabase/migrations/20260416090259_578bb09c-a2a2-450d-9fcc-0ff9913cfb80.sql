CREATE OR REPLACE FUNCTION public.notify_on_interested_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _notify boolean;
BEGIN
  IF NEW.labels IS NULL OR NOT ('Interesado' = ANY(NEW.labels)) THEN
    RETURN NEW;
  END IF;

  SELECT notify_interested INTO _notify
  FROM public.profiles
  WHERE user_id = NEW.user_id
  LIMIT 1;

  IF _notify IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Send email notification
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

  -- Send push notification
  PERFORM extensions.http_post(
    url := 'https://iqhhybmhlkmulwhizpzi.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaGh5Ym1obGttdWx3aGl6cHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTExODIsImV4cCI6MjA5Nzk2NzE4Mn0.sFEe4JK-ZVfK-0Lq0PMva18B1jS23yA7wt1T7V28r_8'
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', '🔥 Lead Interesado',
      'body', COALESCE(NEW.from_name, NEW.from_email) || ': ' || COALESCE(NEW.subject, '(sin asunto)'),
      'url', '/unibox'
    )
  );

  RETURN NEW;
END;
$function$;
