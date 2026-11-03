-- Alerta "Renovar leads" (03-11-2026): campañas ACTIVAS de clientes del Portal de Clientes que ya
-- han contactado al 80 % o más de sus leads. El monitor de salud avisa a team@ una vez por campaña
-- (clave leads_80:<id>) y da por resuelto el aviso cuando se le suben leads (baja del 80 %).
create or replace function public.health_leads_running_out(p_pct int default 80, p_min_leads int default 50)
returns table(campaign_id uuid, name text, client_email text, company text, leads_sent bigint, leads_total bigint, pct numeric)
language sql stable security definer set search_path to 'public' as $$
  with cli as (
    select p.user_id, u.email, coalesce(nullif(p.company_name, ''), nullif(p.full_name, ''), u.email) company
    from public.profiles p join auth.users u on u.id = p.user_id
    where p.allowed_routes is not null and cardinality(p.allowed_routes) > 0 and not coalesce(p.is_client_manager, false)
  ),
  t as (
    select c.id, c.name, cli.email, cli.company,
           count(cl.id) filter (where cl.last_sent_at is not null) sent, count(cl.id) total
    from public.campaigns c join cli on cli.user_id = c.user_id
    join public.campaign_leads cl on cl.campaign_id = c.id
    where c.status = 'active'
    group by c.id, c.name, cli.email, cli.company
  )
  select id, name, email, company, sent, total, round(100.0 * sent / total, 1)
  from t where total >= p_min_leads and sent * 100 >= total * p_pct
  order by sent * 1.0 / total desc;
$$;
revoke all on function public.health_leads_running_out(int, int) from public, anon, authenticated;
