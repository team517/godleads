-- ¿Este cliente ya mandó un correo de CAMPAÑA a esta dirección desde p_since? (06-10-2026)
-- El motor lo mira antes de un PRIMER correo: una "(copia)" de campaña volvía a enviar el paso 1
-- a quien ya lo había recibido. Va por idx_se_user_to_email_lower (user_id, lower(to_email)).
-- created_at y no sent_at: las filas 'bounced' no tienen sent_at.
create or replace function public.user_emailed_recently(p_user uuid, p_email text, p_since timestamptz)
returns boolean
language sql stable security definer set search_path to 'public' as $fn$
  select exists (
    select 1 from public.sent_emails e
    where e.user_id = p_user
      and lower(e.to_email) = lower(trim(p_email))
      and e.status in ('sent', 'bounced')
      and e.campaign_id is not null
      and e.created_at >= p_since);
$fn$;
revoke all on function public.user_emailed_recently(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.user_emailed_recently(uuid, text, timestamptz) to service_role;
