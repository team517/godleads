-- Respuestas de la EMPRESA de un lead de campaña (22-09-2026):
--   · mismo dominio aunque todavía no le hayamos escrito a nadie de ahí, o
--   · mismo nombre con otra terminación (acme.fr ↔ acme.com, mail.acme.es)
-- → se atan a la campaña de ese lead: salen en Campaigns y en Global y avisan al móvil si
--   son de interés o una pregunta. No marcan a ningún lead como "respondido" (sólo campaña).
-- ESPEJO de supabase/functions/_shared/company-brand.ts (mismas expresiones).
create or replace function public.domain_brand(p_domain text)
returns text language sql immutable parallel safe as $$
  select case
    when b = '' or length(b) < 4
      or b ~ '^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|protonmail|proton|aol|gmx|mail|email|correo|zoho|yandex|fastmail|tutanota|orange|wanadoo|free|libero|virgilio|telefonica|movistar|terra|info|web|online|group|grupo|groupe|gruppo|shop|tienda|home|test|example|company|empresa|consulting|global|digital|services|servicios|solutions|soluciones|international)$'
    then null else b end
  from (
    select regexp_replace(
             regexp_replace(lower(btrim(coalesce(p_domain, ''))), '\.((com|co|org|net|gob|gov|edu|ac|or|ne|nom|gv|gouv)\.)?[a-z]{2,}$', ''),
             '^.*\.', '') as b
  ) x;
$$;

-- Para cada dominio dado: la campaña de la empresa (prioridad: mismo dominio con lead en campaña
-- → mismo nombre con envío hecho → mismo nombre con lead en campaña). Campañas activas primero.
create or replace function public.resolve_lead_company_user(p_user uuid, p_domains text[])
returns table(dom text, campaign_id uuid, how text)
language sql stable security definer set search_path = public as $$
  with q as (
    select distinct lower(x) as d, public.domain_brand(lower(x)) as b
    from unnest(p_domains) x
    where auth.uid() is null or auth.uid() = p_user
  ),
  own as (
    select distinct lower(split_part(email, '@', 2)) as d from public.email_accounts where user_id = p_user
  ),
  cand as (
    select q.d, cl.campaign_id, 1 as pri, c.status = 'active' as act, c.created_at, 'dominio'::text as how
    from q
    join public.leads l on l.user_id = p_user and lower(split_part(l.email, '@', 2)) = q.d
    join public.campaign_leads cl on cl.lead_id = l.id
    join public.campaigns c on c.id = cl.campaign_id and c.user_id = p_user
    union all
    select q.d, s.campaign_id, 2, c.status = 'active', c.created_at, 'nombre-envio'
    from q
    join public.sent_emails s on s.user_id = p_user and q.b is not null
      and public.domain_brand(lower(split_part(s.to_email, '@', 2))) = q.b
    join public.campaigns c on c.id = s.campaign_id and c.user_id = p_user
    union all
    select q.d, cl.campaign_id, 3, c.status = 'active', c.created_at, 'nombre-lead'
    from q
    join public.leads l on l.user_id = p_user and q.b is not null
      and public.domain_brand(lower(split_part(l.email, '@', 2))) = q.b
    join public.campaign_leads cl on cl.lead_id = l.id
    join public.campaigns c on c.id = cl.campaign_id and c.user_id = p_user
  )
  select distinct on (d) d, campaign_id, how
  from cand
  where d not in (select d from own)
    -- Por NOMBRE (otra terminación) nunca desde subdominios de envío masivo: news.acme.com es su
    -- boletín, no una respuesta. Por dominio exacto sí (ya salía en Global como empresa del lead).
    and (pri = 1 or d !~ '^(news|newsletter|newsletters|mailing|marketing|email|em|e|mail|info|noticias|notification|notifications|noreply|no-reply|bounce|bounces|campaign|campaigns|mkt)\.')
    and public.domain_brand(d) is not null  -- nunca correo gratuito ni nombres genéricos
  order by d, pri, act desc, created_at desc;
$$;
revoke all on function public.resolve_lead_company_user(uuid, text[]) from public, anon, authenticated;
grant execute on function public.resolve_lead_company_user(uuid, text[]) to service_role;
-- Índices (creados en vivo con CONCURRENTLY, uno por archivo):
--   create index concurrently if not exists idx_se_user_brand on public.sent_emails (user_id, public.domain_brand(lower(split_part(to_email, '@', 2))));
--   create index concurrently if not exists idx_leads_user_brand on public.leads (user_id, public.domain_brand(lower(split_part(email, '@', 2))));
