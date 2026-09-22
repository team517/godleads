-- El resumen diario (daily-digest) no debe listar tráfico de warm-up como "lead caliente".
create or replace function public.hot_leads_today(p_days integer default 0)
returns table(user_id uuid, from_email text, subject text, snippet text, campaign text, interesado boolean, pregunta boolean, received_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with admins as (select ur.user_id from public.user_roles ur where ur.role = 'admin')
  select
    m.user_id, m.from_email, m.subject,
    left(btrim(regexp_replace(coalesce(m.body_text, ''), '\s+', ' ', 'g')), 200) as snippet,
    c.name as campaign,
    coalesce(m.labels @> array['Interesado']::text[], false) as interesado,
    coalesce(m.labels @> array['Pregunta']::text[], false)   as pregunta,
    m.received_at
  from public.inbox_messages m
  join admins a on a.user_id = m.user_id
  left join public.campaigns c on c.id = m.campaign_id
  where m.is_archived = false
    and coalesce(m.is_warmup, false) = false
    and (m.lead_id is not null or m.campaign_id is not null)
    and not ((coalesce(m.subject, '') || ' ' || coalesce(m.body_text, '')) ~*
      '(out of office|automatic reply|auto.?reply|no longer (available|with|here)|on (annual |sick )?leave|will be (out|away|back)|de vacaciones|fuera de la oficina|respuesta autom|ausencia|estar[ée] fuera|r[ée]ponse automatique|absent du bureau|en cong[ée]|de retour le|risposta automatica|fuori sede|in ferie|assenz|abwesen|nicht im b[üu]ro|automatische antwort)')
    and m.received_at >= (case when p_days > 0
        then now() - make_interval(days => p_days)
        else (((now() at time zone 'Europe/Madrid')::date)::timestamp at time zone 'Europe/Madrid')
      end)
    and (m.labels @> array['Interesado']::text[] or m.labels @> array['Pregunta']::text[])
  order by (m.labels @> array['Interesado']::text[]) desc, m.received_at desc
  limit 40;
$$;
