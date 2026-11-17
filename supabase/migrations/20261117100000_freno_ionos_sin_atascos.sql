-- Freno de IONOS sin atascos (17-11-2026).
--
-- Lo que pasó el 16 y el 17-11: 144 buzones de 9 clientes (todos los de coco y visualtis, 23 de
-- dialogfy, 13 de publiup, 12 de seoinnova…) dejaron de entrar en IONOS el fin de semana
-- ("535 Authentication credentials invalid") mientras el resto de buzones enviaba bien. Como eran
-- de varios clientes, el freno lo tomaba por un bloqueo de IONOS: pausaba TODOS los buzones de IONOS
-- 15 min y devolvía esas cuentas a "connected"; al acabar la pausa volvían a fallar y vuelta a
-- empezar. Resultado: de ~2.000 envíos/hora el viernes a ~10/hora el lunes y el martes.
--
-- Arreglo: un buzón cuya racha de 535/454 empezó hace más de 25 min y no ha enviado nada desde
-- entonces ya no es "un bloqueo de IONOS", es SU contraseña. Deja de contar para el freno, y el
-- motor lo marca "auth_failed" como a cualquier contraseña mala (la reconexión automática lo vuelve
-- a probar sola y lo reactiva en cuanto entra). Un bloqueo de verdad de IONOS sigue frenando:
-- en él fallan buzones NUEVOS cada pasada.

CREATE OR REPLACE FUNCTION public.ionos_auth_failures(p_minutes integer DEFAULT 5)
 RETURNS TABLE(account_id uuid, user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recientes as (
    select distinct s.account_id, s.user_id
    from public.sent_emails s
    join public.email_accounts a on a.id = s.account_id
    where s.status = 'failed'
      and s.created_at > now() - make_interval(mins => greatest(1, least(p_minutes, 60)))
      and s.error_message ~* '\m(535|454)\M'
      and a.smtp_host ~* '(^|\.)(ionos|1and1)\.'
  )
  select r.account_id, r.user_id
  from recientes r
  where not exists (
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
