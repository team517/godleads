-- Alta con prueba (11-11-2026): la pestaña de /empezar que espera "Confirma tu correo" pregunta cada
-- pocos segundos si ese usuario ya confirmó. Se pregunta por el id que devolvió signUp (un uuid
-- imposible de adivinar), no por el correo: así no sirve para averiguar qué correos tienen cuenta.
create or replace function public.signup_email_confirmed(p_user uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.signup_email_confirmed(uuid) from public;
grant execute on function public.signup_email_confirmed(uuid) to anon, authenticated;
