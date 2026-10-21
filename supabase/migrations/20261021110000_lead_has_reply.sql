-- "¿Este lead ya contestó?" antes de cada envío (21-10-2026). El motor lo preguntaba con
-- from_email ILIKE, que no usa el índice idx_inbox_user_from_email (user_id, lower(from_email)):
-- 778 ms por lead en support@ (29.000 mensajes), cientos de veces por pasada. Igual resultado con
-- lower(from_email) = lower(email): 1,5 ms. Se miran las dos cosas de siempre: por lead y por dirección,
-- sin contar los fuera de oficina (auto_signal).
create or replace function public.lead_has_reply(p_user uuid, p_lead uuid, p_email text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.inbox_messages m where m.lead_id = p_lead and m.auto_signal is null)
      or exists (select 1 from public.inbox_messages m
                  where m.user_id = p_user and lower(m.from_email) = lower(btrim(coalesce(p_email, '')))
                    and m.auto_signal is null);
$$;
revoke all on function public.lead_has_reply(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lead_has_reply(uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
