-- Daily digest source: today's HOT inbox replies (Interesado / Pregunta) for the
-- agency's admin account(s). Real replies only (tied to a lead/campaign, not archived).
-- "Today" = the current calendar day in Europe/Madrid. service_role-only.
-- p_days > 0 widens the window to the last N days (used only for testing the email).
drop function if exists public.hot_leads_today();
drop function if exists public.hot_leads_today(int);
create or replace function public.hot_leads_today(p_days int default 0)
returns table (
  user_id       uuid,
  from_email    text,
  subject       text,
  snippet       text,
  campaign      text,
  interesado    boolean,
  pregunta      boolean,
  received_at   timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with admins as (select ur.user_id from public.user_roles ur where ur.role = 'admin')
  select
    m.user_id,
    m.from_email,
    m.subject,
    left(btrim(regexp_replace(coalesce(m.body_text, ''), '\s+', ' ', 'g')), 200) as snippet,
    c.name as campaign,
    coalesce(m.labels @> array['Interesado']::text[], false) as interesado,
    coalesce(m.labels @> array['Pregunta']::text[], false)   as pregunta,
    m.received_at
  from public.inbox_messages m
  join admins a on a.user_id = m.user_id
  left join public.campaigns c on c.id = m.campaign_id
  where m.is_archived = false
    and (m.lead_id is not null or m.campaign_id is not null)
    -- Exclude obvious auto-replies / out-of-office / "no longer here" that the intent
    -- classifier sometimes mislabels as Interesado — they aren't real hot leads.
    and not ((coalesce(m.subject, '') || ' ' || coalesce(m.body_text, '')) ~*
      '(out of office|automatic reply|auto.?reply|no longer (available|with|here)|on (annual |sick )?leave|will be (out|away|back)|de vacaciones|fuera de la oficina|respuesta autom|ausencia|estar[ée] fuera|r[ée]ponse automatique|absent du bureau|en cong[ée]|de retour le|risposta automatica|fuori sede|in ferie|assenz|abwesen|nicht im b[üu]ro|automatische antwort)')
    and m.received_at >= (case when p_days > 0
        then now() - make_interval(days => p_days)                                      -- test lookback
        else (((now() at time zone 'Europe/Madrid')::date)::timestamp at time zone 'Europe/Madrid') -- today (Madrid)
      end)
    and (m.labels @> array['Interesado']::text[] or m.labels @> array['Pregunta']::text[])
  order by (m.labels @> array['Interesado']::text[]) desc, m.received_at desc
  limit 40;
$$;

revoke all on function public.hot_leads_today(int) from public, anon, authenticated;
grant execute on function public.hot_leads_today(int) to service_role;
