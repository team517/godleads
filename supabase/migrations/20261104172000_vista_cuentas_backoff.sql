-- Pantalla Cuentas de correo vacía (04-11-2026): la lista pide "backoff_until" (chip "En pausa
-- hasta HH:MM" del motor resiliente, 02-11) a la vista email_accounts_safe, y la vista no tenía esa
-- columna: PostgREST devolvía 400 y la pantalla se quedaba en "Conecta una cuenta de envío" aunque
-- el cliente tuviera 60 buzones. Se añaden backoff_until y backoff_level AL FINAL (create or replace
-- view sólo admite columnas nuevas al final). Sigue con security_invoker (RLS del usuario) y las
-- contraseñas enmascaradas.
create or replace view public.email_accounts_safe with (security_invoker = true) as
 SELECT id, user_id, email, first_name, last_name,
        imap_username, imap_host, imap_port,
        smtp_username, smtp_host, smtp_port,
        status, tags, daily_limit, sent_today,
        send_start_hour, send_end_hour, last_send_at,
        warmup_enabled, warmup_day, warmup_limit, warmup_increment, warmup_started_at,
        warmup_score, warmup_status_instantly, warmup_synced_at,
        last_health_check, created_at, updated_at, signature_html,
        last_uid_inbox, last_uid_sent, last_error, last_sync, notes,
        '••••••••'::text AS imap_password,
        '••••••••'::text AS smtp_password,
        backoff_until,
        backoff_level
   FROM public.email_accounts;

-- Desde 20261006142000 los permisos de email_accounts son POR COLUMNA (todas menos las contraseñas).
-- Las columnas añadidas después (backoff_until, backoff_level, 02-11) no tenían SELECT para
-- authenticated: con security_invoker, leer la vista daba "permission denied for table email_accounts".
-- Regla: toda columna nueva de email_accounts que no sea secreta necesita este grant.
grant select (backoff_until, backoff_level) on public.email_accounts to authenticated;
