-- Los avisos de antispam (Mailinblack: "confírmame que eres humano") ya enlazados por asunto
-- cuentan como respuesta automática (07-10-2026, petición del dueño): auto_signal + replied_at del
-- envío a ese lead (suma en "Respondidos"), sin parar la secuencia.
with m as (
  update public.inbox_messages
     set auto_signal = 'antispam:challenge'
   where auto_signal is null and lead_id is not null and campaign_id is not null
     and from_email ~* '@([a-z0-9-]+\.)*(mailinblack\.com|boxbe\.com|spamarrest\.com|sanebox\.com|mxguarddog\.com|altospam\.com|vadesecure\.com)$'
  returning user_id, lead_id, campaign_id, received_at
)
update public.sent_emails s
   set replied_at = m.received_at
  from m
 where s.user_id = m.user_id and s.lead_id = m.lead_id and s.campaign_id = m.campaign_id and s.replied_at is null;
