-- Espera tras un login IMAP fallido (17-11-2026).
--
-- La sincronización de la bandeja (fetch-inbox, 6 crons por minuto) entra en TODOS los buzones
-- "connected" y "auth_failed" sin esperar nunca entre fallos. Desde el sábado 14-11 (15:44-21:42)
-- unos 440 buzones de IONOS dejaron de aceptar su contraseña y cada vuelta les volvía a intentar el
-- login: cientos de logins fallidos por hora desde nuestra IP. IONOS lo trata como un ataque y corta
-- las conexiones de nuestro servidor ("Timeout connect smtp.ionos.es:465"), también las de envío.
--
-- Ahora cada buzón lleva su espera: tras un "IMAP login failed" no se vuelve a intentar hasta
-- imap_retry_at (15 min, 1 h, 3 h y luego cada 6 h). Al entrar bien se pone a cero. Si alguien
-- cambia su usuario/contraseña/servidor, o la reconexión automática lo devuelve a "connected",
-- también se pone a cero y se prueba en la siguiente vuelta.

alter table public.email_accounts
  add column if not exists imap_fail_count int not null default 0,
  add column if not exists imap_retry_at timestamptz not null default 'epoch';

create index if not exists email_accounts_imap_retry_at_idx on public.email_accounts (imap_retry_at)
  where imap_retry_at > 'epoch';

create or replace function public.reset_imap_retry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.imap_password is distinct from old.imap_password
     or new.imap_username is distinct from old.imap_username
     or new.imap_host is distinct from old.imap_host
     or new.imap_port is distinct from old.imap_port
     or new.smtp_password is distinct from old.smtp_password
     or (new.status = 'connected' and old.status in ('auth_failed', 'error', 'pending'))
  then
    new.imap_fail_count := 0;
    new.imap_retry_at := 'epoch';
  end if;
  return new;
end;
$$;

drop trigger if exists email_accounts_reset_imap_retry on public.email_accounts;
create trigger email_accounts_reset_imap_retry
  before update on public.email_accounts
  for each row execute function public.reset_imap_retry();
