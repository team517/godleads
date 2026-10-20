-- Leads nuevos repartidos por EMPRESA (20-10-2026, CHIPSFINDER FRANCE enviaba el 25 % de su límite).
-- El motor cogía los 500 pendientes más antiguos por orden de subida. Una lista subida agrupada por
-- empresa (Airbus 3.938, Orange 3.367, Safran 1.996…) llenaba esa ventana con 2-3 empresas, el tope de
-- 3 primeros correos por empresa y día las saltaba casi todas y las otras 2.245 empresas no llegaban.
-- Esta función devuelve el lead pendiente MÁS ANTIGUO DE CADA EMPRESA (dominio), en orden de antigüedad:
-- el motor la usa sólo cuando la ventana normal está concentrada en pocas empresas.
create or replace function public.pending_leads_by_company(p_campaign uuid, p_limit integer default 500)
returns uuid[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(id order by id), '{}'::uuid[]) from (
    select id from (
      select distinct on (lower(split_part(l.email, '@', 2))) cl.id
        from campaign_leads cl
        join leads l on l.id = cl.lead_id
       where cl.campaign_id = p_campaign and cl.status = 'pending'
         and (cl.next_attempt_at is null or cl.next_attempt_at <= now())
       order by lower(split_part(l.email, '@', 2)), cl.id
    ) x
    order by id
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ) y;
$$;
revoke all on function public.pending_leads_by_company(uuid, integer) from public, anon, authenticated;
grant execute on function public.pending_leads_by_company(uuid, integer) to service_role;
