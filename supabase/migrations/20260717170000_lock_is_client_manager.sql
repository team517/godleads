-- SECURITY: stop a client from self-assigning is_client_manager (privilege escalation).
-- The profiles UPDATE policy already locks coins / allowed_routes / max_email_accounts to
-- their current values via WITH CHECK; is_client_manager was added later and was NOT locked,
-- so a client could POST profiles.update({is_client_manager:true}) on their own row and gain
-- access to the Portal de Clientes. Add it to the same lock. Only service_role (the
-- admin-users edge fn) can still set it.

alter policy "Users can update own profile" on public.profiles
with check (
  (auth.uid() = user_id)
  and (coins = (select p.coins from profiles p where p.user_id = auth.uid()))
  and (not (max_email_accounts is distinct from (select p.max_email_accounts from profiles p where p.user_id = auth.uid())))
  and (not (allowed_routes is distinct from (select p.allowed_routes from profiles p where p.user_id = auth.uid())))
  and (not (is_client_manager is distinct from (select p.is_client_manager from profiles p where p.user_id = auth.uid())))
);
