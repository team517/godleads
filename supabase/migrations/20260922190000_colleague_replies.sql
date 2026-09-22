-- Respuestas de un COMPAÑERO del lead (misma empresa, otra dirección) o a un envío hecho desde OTRO
-- buzón del mismo usuario: se enlazan a su lead/campaña aunque no las mandara ese buzón.
create or replace function public.resolve_sent_by_domains_user(p_user uuid, p_domains text[])
returns table(dom text, lead_id uuid, campaign_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (d) d as dom, s.lead_id, s.campaign_id
  from (
    select lower(split_part(to_email,'@',2)) as d, lead_id, campaign_id, sent_at
    from public.sent_emails
    where user_id = p_user
      and (auth.uid() is null or auth.uid() = p_user)
      and lower(split_part(to_email,'@',2)) = any(p_domains)
      and campaign_id is not null and lead_id is not null
  ) s
  order by d, sent_at desc nulls last;
$$;
revoke all on function public.resolve_sent_by_domains_user(uuid, text[]) from public, anon, authenticated;
grant execute on function public.resolve_sent_by_domains_user(uuid, text[]) to service_role;

-- ¿Cuáles de estos dominios tienen algún lead del usuario? (para que una respuesta de la empresa de un
-- lead nunca se tache de warm-up al sincronizar)
create or replace function public.lead_domains_hit(p_user uuid, p_domains text[])
returns table(dom text)
language sql stable security definer set search_path = public as $$
  select distinct lower(split_part(l.email,'@',2))
  from public.leads l
  where l.user_id = p_user
    and (auth.uid() is null or auth.uid() = p_user)
    and lower(split_part(l.email,'@',2)) = any(p_domains);
$$;
revoke all on function public.lead_domains_hit(uuid, text[]) from public, anon, authenticated;
grant execute on function public.lead_domains_hit(uuid, text[]) to service_role;
-- Índices para que las dos funciones vayan por índice (creados en vivo con CONCURRENTLY).
create index if not exists idx_se_user_domain on public.sent_emails (user_id, (lower(split_part(to_email, '@', 2))));
create index if not exists idx_leads_user_domain on public.leads (user_id, (lower(split_part(email, '@', 2))));
