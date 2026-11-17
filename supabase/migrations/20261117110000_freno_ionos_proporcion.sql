-- Freno de IONOS: sólo es un bloqueo si IONOS está fallando de verdad (17-11-2026, segunda parte).
--
-- Tras el arreglo de las 10:50 seguían apareciendo buzones rotos "nuevos" (no se usaban desde el
-- viernes: publiup, chipsfinder…). Cinco de dos clientes bastaban para pausar 15 min a TODOS,
-- aunque en esos mismos minutos habían salido 137 correos bien por IONOS.
--
-- Regla añadida: si en la ventana salen por IONOS al menos el doble de correos de los que fallan
-- por login (535/454), IONOS funciona y esos fallos son contraseñas de esos buzones → la función no
-- devuelve nada, el freno no salta y el motor marca esas cuentas "auth_failed" (la reconexión
-- automática las reactiva solas cuando vuelven a entrar). En un bloqueo real (19-10: 53 de 54
-- logins rechazados; 02-11: casi nada salía) la proporción es la contraria y el freno sigue igual.

CREATE OR REPLACE FUNCTION public.ionos_auth_failures(p_minutes integer DEFAULT 5)
 RETURNS TABLE(account_id uuid, user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ventana as (
    select now() - make_interval(mins => greatest(1, least(p_minutes, 60))) as desde
  ),
  recientes as (
    select distinct s.account_id, s.user_id
    from public.sent_emails s
    join public.email_accounts a on a.id = s.account_id
    where s.status = 'failed'
      and s.created_at > (select desde from ventana)
      and s.error_message ~* '\m(535|454)\M'
      and a.smtp_host ~* '(^|\.)(ionos|1and1)\.'
  ),
  fallos as (
    select count(*) as n
    from public.sent_emails s
    join public.email_accounts a on a.id = s.account_id
    where s.status = 'failed'
      and s.created_at > (select desde from ventana)
      and s.error_message ~* '\m(535|454)\M'
      and a.smtp_host ~* '(^|\.)(ionos|1and1)\.'
  ),
  enviados as (
    select count(*) as n
    from public.sent_emails s
    join public.email_accounts a on a.id = s.account_id
    where s.status = 'sent'
      and s.sent_at > (select desde from ventana)
      and a.smtp_host ~* '(^|\.)(ionos|1and1)\.'
  )
  select r.account_id, r.user_id
  from recientes r
  where (select n from enviados) < 2 * greatest(1, (select n from fallos))
    and not exists (
      -- ya fallaba hace más de 25 min y desde entonces no ha enviado nada: es su contraseña
      select 1 from public.sent_emails f
      where f.account_id = r.account_id
        and f.status = 'failed'
        and f.created_at between now() - interval '3 days' and now() - interval '25 minutes'
        and f.error_message ~* '\m(535|454)\M'
        and not exists (
          select 1 from public.sent_emails ok
          where ok.account_id = r.account_id and ok.status = 'sent' and ok.sent_at > f.created_at
        )
    );
$function$;

revoke all on function public.ionos_auth_failures(integer) from public, anon, authenticated;
grant execute on function public.ionos_auth_failures(integer) to service_role;
