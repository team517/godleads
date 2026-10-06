-- Auditoría 06-10-2026 (#3, P1): las contraseñas SMTP/IMAP de email_accounts están en claro y el rol
-- `authenticated` tenía SELECT a nivel de TABLA, así que cualquier usuario con sesión (o un XSS)
-- podía leerlas con PostgREST (`select=smtp_password,imap_password`).
--
-- Un REVOKE de columna no sirve mientras exista el SELECT de tabla (el privilegio de tabla cubre
-- todas las columnas). Se hace en dos pasos: se quita el SELECT de tabla y se concede SELECT sólo
-- sobre las columnas que NO son contraseña (la lista se genera del esquema en vivo al aplicar).
--
-- Lo que NO cambia: INSERT/UPDATE siguen permitidos (se puede ESCRIBIR una contraseña nueva, no leerla);
-- el service role (edge functions) lee todo; la vista email_accounts_safe (security_invoker) sólo
-- referencia columnas permitidas y devuelve '••••••••' en las contraseñas.
--
-- OJO al añadir columnas nuevas a email_accounts: hay que conceder su SELECT a mano
--   grant select (<columna>) on public.email_accounts to authenticated;
-- o el frontend (que lista columnas, nunca `*`) recibirá "permission denied".

revoke select on public.email_accounts from authenticated;
revoke select on public.email_accounts from anon;

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'email_accounts'
     and column_name not in ('smtp_password', 'imap_password');
  if cols is null then
    raise exception 'email_accounts no tiene columnas visibles: no se aplica nada';
  end if;
  execute format('grant select (%s) on public.email_accounts to authenticated', cols);
end $$;

-- Cinturón y tirantes: aunque quedase algún permiso de columna suelto, las contraseñas no se leen.
revoke select (smtp_password, imap_password) on public.email_accounts from authenticated, anon;

-- La tabla de archivo (cuentas borradas) también guarda contraseñas: tenía SELECT para anon y
-- authenticated (RLS activada y sin políticas, así que no devolvía filas, pero no debe tener acceso).
do $$
begin
  if to_regclass('public.email_accounts_archive') is not null then
    execute 'revoke all on table public.email_accounts_archive from anon, authenticated';
  end if;
end $$;
