-- Ritmo por EMPRESA (25-09-2026): cuántos correos ha recibido hoy cada empresa (dominio del
-- destinatario) de un mismo cliente, sumando TODAS sus campañas, y cuándo fue el último.
-- El motor lo usa para no mandar más de N al día a la misma empresa ni dos seguidos: airbus.com
-- recibió 107 correos en un día desde 6 campañas del mismo cliente.
create or replace function public.user_company_sends_today(p_user uuid, p_since timestamptz)
returns table(dom text, n bigint, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  select lower(split_part(to_email, '@', 2)) as dom, count(*) as n, max(sent_at) as ultimo
  from public.sent_emails
  where user_id = p_user
    and sent_at >= p_since
    and sent_at is not null
    and status = 'sent'
  group by 1;
$$;
revoke all on function public.user_company_sends_today(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.user_company_sends_today(uuid, timestamptz) to service_role;
