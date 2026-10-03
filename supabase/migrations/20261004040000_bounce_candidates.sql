-- Candidatos a "el envío que rebotó", para fetch-inbox (la elección está en _shared/bounce-match.ts).
--  · message_id: envíos cuyo Message-ID es el del correo devuelto (idx_se_smtp_mid_lower) → exacto.
--  · destinatario: envíos del buzón a ese destinatario anteriores al rebote (idx_se_user_to_email_lower),
--    de apoyo cuando el aviso no devuelve las cabeceras del original.
-- 04-10-2026: un rebote tardío de IONOS se colgaba de "el último envío a ese destinatario" y marcó
-- como no entregada una respuesta posterior que sí había llegado.
create or replace function public.bounce_candidates(
  p_user uuid, p_account uuid, p_mids text[], p_recipients text[], p_after timestamptz, p_before timestamptz
)
returns table(
  id uuid, lead_id uuid, campaign_id uuid, bounced_at timestamptz, user_id uuid,
  to_email text, subject text, created_at timestamptz, how text
)
language sql stable security definer set search_path to 'public' as $fn$
  (select s.id, s.lead_id, s.campaign_id, s.bounced_at, s.user_id, s.to_email, s.subject, s.created_at, 'message_id'::text
   from public.sent_emails s
   where s.account_id = p_account and s.smtp_message_id is not null
     and lower(s.smtp_message_id) = any(coalesce(p_mids, '{}'::text[]))
   order by s.created_at desc limit 3)
  union all
  (select s.id, s.lead_id, s.campaign_id, s.bounced_at, s.user_id, s.to_email, s.subject, s.created_at, 'destinatario'::text
   from public.sent_emails s
   where s.user_id = p_user and s.account_id = p_account
     and lower(s.to_email) = any(coalesce(p_recipients, '{}'::text[]))
     and s.created_at >= p_after and s.created_at < p_before
   order by s.created_at desc limit 8);
$fn$;
revoke all on function public.bounce_candidates(uuid, uuid, text[], text[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.bounce_candidates(uuid, uuid, text[], text[], timestamptz, timestamptz) to service_role;
