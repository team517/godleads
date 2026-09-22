-- Funciones SECURITY DEFINER que sólo usan el motor, fetch-inbox (service_role) y pg_cron (postgres),
-- pero que cualquiera con la clave pública anon podía ejecutar:
--   suppress_email_global(p_user_id, email): metía un correo en la lista de bloqueados de CUALQUIER
--     usuario y marcaba sus leads como rebotados (sabotaje de campañas ajenas).
--   purge_old_warmup(días): borraba mensajes del Unibox de todos los usuarios.
--   resolve_sent_by_domains(cuenta, dominios): devolvía leads/campañas de una cuenta ajena.
revoke all on function public.suppress_email_global(uuid, text, text) from public, anon, authenticated;
revoke all on function public.purge_old_warmup(integer) from public, anon, authenticated;
revoke all on function public.resolve_sent_by_domains(uuid, text[]) from public, anon, authenticated;
grant execute on function public.suppress_email_global(uuid, text, text) to service_role;
grant execute on function public.purge_old_warmup(integer) to service_role;
grant execute on function public.resolve_sent_by_domains(uuid, text[]) to service_role;
