-- Parar la secuencia cuando el correo rebota porque la DIRECCIÓN NO EXISTE (05-10-2026, OK del dueño).
--
-- Antes: el rebote que llega tarde (aviso del servidor) marcaba sent_emails.bounced_at, pero el lead
-- seguía "in_progress" y recibía los siguientes pasos. Del 28-09 al 05-10: 228 seguimientos a
-- direcciones que ya habían rebotado (197 volvieron a rebotar) y 484 leads más en esa situación.
--
-- Sólo cuenta como dirección muerta lo que lo dice el servidor del destinatario: 5.1.x, usuario
-- desconocido / no existe, cuenta inactiva, RecipientNotFound, y el "550 5.4.1 Recipient address
-- rejected: Access denied" de Microsoft 365 (el buzón no existe en esa empresa).
-- NUNCA un bloqueo nuestro (Spamhaus / IONOS / 5.7.x / spam / reputación / límite / buzón lleno /
-- temporal) ni el aviso genérico de IONOS ("could not be delivered… possible reasons"): ahí la
-- dirección está bien y parar perdería el lead.
create or replace function public.is_dead_address_bounce(p text)
returns boolean
language sql
immutable
set search_path to 'public'
as $fn$
  select coalesce(p, '') <> ''
     and p ~* '5\.1\.[0-9]|user unknown|unknown user|no such user|no such recipient|does not exist|doesn''t exist|recipient ?not ?found|recipient address rejected|address rejected|mailbox unavailable|mailbox not found|no mailbox|account (that you tried to reach )?(is |has been )?(inactive|disabled|deleted)|is inactive|no longer accepts mail|usuario desconocido|no existe|destinatario (desconocido|inexistente)'
     and p !~* 'spamhaus|\ysbl\y|zen\.|blocked using|block ?list|black ?list|reputation|5\.7\.[0-9]|spam|policy|rate limit|too many|quota|mailbox full|over quota|temporar|try again|greylist|possible reasons'
$fn$;

create or replace function public.stop_sequence_on_dead_bounce()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.bounced_at is not null and old.bounced_at is null and new.lead_id is not null
     and public.is_dead_address_bounce(new.error_message) then
    -- Ese lead (y cualquier otro lead de la misma cuenta con la misma dirección) deja de recibir pasos.
    update public.campaign_leads cl set status = 'bounced'
     where cl.status in ('pending', 'in_progress')
       and (cl.lead_id = new.lead_id
            or cl.lead_id in (select l.id from public.leads l where l.user_id = new.user_id and l.email = new.to_email));
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_stop_sequence_on_dead_bounce on public.sent_emails;
create trigger trg_stop_sequence_on_dead_bounce
  after update of bounced_at on public.sent_emails
  for each row execute function public.stop_sequence_on_dead_bounce();
