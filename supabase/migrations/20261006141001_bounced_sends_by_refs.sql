-- Rebote desmentido (06-10-2026). Una respuesta MANUAL marcada como rebotada y el destinatario
-- contesta después a ESE correo: fetch-inbox le quita la marca (bounceDismissal, _shared/bounce-match.ts).
-- Esta función trae, por el Message-ID del correo al que contesta (índice idx_se_smtp_mid_lower),
-- los envíos sin campaña que siguen marcados como rebotados. Sin ella, fetch-inbox busca sólo en
-- el buzón que recibe la respuesta.
create or replace function public.bounced_sends_by_refs(p_user uuid, p_refs text[])
returns table(
  id uuid, to_email text, smtp_message_id text, bounced_at timestamptz,
  campaign_id uuid, error_message text, created_at timestamptz
)
language sql stable security definer set search_path to 'public' as $fn$
  select s.id, s.to_email, s.smtp_message_id, s.bounced_at, s.campaign_id, s.error_message, s.created_at
  from public.sent_emails s
  where s.smtp_message_id is not null
    and lower(s.smtp_message_id) = any(coalesce(p_refs, '{}'::text[]))
    and s.user_id = p_user
    and s.campaign_id is null
    and s.bounced_at is not null
  limit 200;
$fn$;
revoke all on function public.bounced_sends_by_refs(uuid, text[]) from public, anon, authenticated;
grant execute on function public.bounced_sends_by_refs(uuid, text[]) to service_role;
