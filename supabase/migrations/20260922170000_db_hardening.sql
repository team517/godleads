-- Endurecimiento de la base de datos (auditoría 22-09-2026). Todo compatible con el frontend actual.

-- 1) Defensa en profundidad en las dos RPC internas: aunque alguien las ejecutara con sesión,
--    sólo pueden actuar sobre SUS datos (service_role no tiene auth.uid() y pasa).
create or replace function public.suppress_email_global(p_user_id uuid, p_email text, p_reason text default 'bounce')
returns integer language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_flagged integer := 0;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then return 0; end if;
  if p_user_id is null or v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return 0;
  end if;
  insert into public.blocklist (user_id, entry_type, value)
  values (p_user_id, 'email', v_email)
  on conflict (user_id, entry_type, value) do nothing;
  update public.leads set status = 'bounced'
  where user_id = p_user_id and lower(email) = v_email
    and coalesce(status, '') <> 'bounced';
  get diagnostics v_flagged = row_count;
  return v_flagged;
end; $$;

create or replace function public.resolve_sent_by_domains(p_account uuid, p_domains text[])
returns table(dom text, lead_id uuid, campaign_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (d) d as dom, s.lead_id, s.campaign_id
  from (
    select lower(split_part(to_email,'@',2)) as d, lead_id, campaign_id, sent_at
    from public.sent_emails
    where account_id = p_account
      and (auth.uid() is null or exists (select 1 from public.email_accounts ea where ea.id = p_account and ea.user_id = auth.uid()))
      and lower(split_part(to_email,'@',2)) = any(p_domains)
      and campaign_id is not null and lead_id is not null
  ) s
  order by d, sent_at desc nulls last;
$$;
revoke all on function public.suppress_email_global(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolve_sent_by_domains(uuid, text[]) from public, anon, authenticated;
revoke all on function public.purge_old_warmup(integer) from public, anon, authenticated;

-- 2) El secreto OAuth de Google: RLS activado (sin políticas = sólo service_role), no sólo revoke.
alter table public.google_oauth_config enable row level security;

-- 3) UPDATE sin WITH CHECK: se podía cambiar el dueño de una fila propia a otro usuario
--    (un follow_up "regalado" a otra cuenta se enviaba desde SU buzón).
alter policy follow_ups_update on public.follow_ups with check (owner_id = auth.uid());
alter policy seg_threads_upd on public.seg_threads with check (owner_id = auth.uid());
alter policy reply_templates_update on public.reply_templates with check (user_id = auth.uid());
alter policy campaign_managers_update_own on public.campaign_managers with check (auth.uid() = user_id);
alter policy "Users can update own community messages" on public.community_messages with check (auth.uid() = user_id);
alter policy "Users update own channel" on public.godtube_channels with check (auth.uid() = user_id);
alter policy "Users update own videos" on public.godtube_videos with check (auth.uid() = user_id);

-- 4) Enlaces campaña↔cuenta y campaña↔lead: la cuenta y el lead también tienen que ser del usuario
--    (antes bastaba con que la campaña lo fuera: se podía colgar un buzón ajeno de una campaña propia).
alter policy "Users manage own campaign accounts" on public.campaign_accounts
  with check (
    exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid())
    and exists (select 1 from public.email_accounts a where a.id = account_id and a.user_id = auth.uid())
  );
alter policy "Users manage own campaign leads" on public.campaign_leads
  with check (
    exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid())
    and exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

-- 5) domain_auth: cada usuario ve sólo los dominios de sus buzones (la tabla entera era la lista de
--    dominios de envío de TODOS los clientes).
drop policy if exists "domain_auth: leer autenticado" on public.domain_auth;
create policy "domain_auth: leer los propios" on public.domain_auth for select to authenticated
  using (exists (select 1 from public.email_accounts ea where ea.user_id = auth.uid() and lower(split_part(ea.email,'@',2)) = domain_auth.domain));

-- 6) onboarding_by_slug: sólo el dueño del slug, su cliente enlazado o la agencia (admin / gestor).
create or replace function public.onboarding_by_slug(p_slug text)
returns table(company_name text, logo_url text, brand_color text, onboarding_status jsonb, client_user_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select p.company_name, p.logo_url, p.brand_color, p.onboarding_status, p.user_id
  from public.profiles p
  where lower(p.onboarding_slug) = lower(p_slug)
    and (
      p.user_id = auth.uid()
      or exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
      or exists (select 1 from public.profiles me where me.user_id = auth.uid() and me.is_client_manager)
      or exists (select 1 from public.clients c where c.login_user_id = auth.uid() and c.owner_user_id = p.user_id)
    )
  limit 1;
$$;

-- 7) La lista de bloqueados también se aplica al EDITAR el email de un lead, no sólo al crearlo.
drop trigger if exists trg_skip_blocked_leads on public.leads;
create trigger trg_skip_blocked_leads before insert or update of email on public.leads
  for each row execute function public.skip_blocked_leads();
