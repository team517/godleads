-- Subir leads a una campaña en UNA petición por tanda (20-10-2026, "que se suba más rápido sin
-- dejarse nada"). Antes el navegador hacía, por cada 500 filas: 3 búsquedas de los que ya estaban,
-- UNA PETICIÓN POR CADA LEAD REPETIDO para actualizarlo, la inserción y el enlace a la campaña, todo
-- en serie. Ahora una tanda (hasta 2.000 filas) se resuelve aquí dentro, en una sola transacción:
--   · los emails que YA están en esta campaña se actualizan (columnas nuevas encima de las viejas,
--     igual que mergeLeadFields: un valor vacío no borra nada) y su estado del email;
--   · los nuevos se insertan y se enlazan a la campaña;
--   · los bloqueados los sigue saltando el trigger skip_blocked_leads (no entran ni cuentan).
-- p_rows: [{ "email": "...", "custom_fields": {...}, "verification_status": "valid|risky|invalid" }]
create or replace function public.import_campaign_leads(p_campaign uuid, p_rows jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_added int := 0;
  v_updated int := 0;
  v_input int := 0;
begin
  if v_uid is null or p_campaign is null
     or not exists (select 1 from campaigns c where c.id = p_campaign and c.user_id = v_uid) then
    raise exception 'campaña no encontrada' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'tanda inválida (máximo 2000 filas)' using errcode = '22023';
  end if;

  create temp table if not exists _imp_in (email text primary key, cf jsonb, vs text) on commit drop;
  truncate _imp_in;
  insert into _imp_in (email, cf, vs)
  select distinct on (em) em,
         coalesce(case when jsonb_typeof(e->'custom_fields') = 'object' then e->'custom_fields' end, '{}'::jsonb),
         case when e->>'verification_status' in ('valid','risky','invalid') then e->>'verification_status' end
    from (select lower(btrim(e->>'email')) em, e, ord from jsonb_array_elements(p_rows) with ordinality as t(e, ord)) s
   where em like '%_@_%'
   order by em, ord desc;           -- el mismo email dos veces en la tanda: gana la última fila
  get diagnostics v_input = row_count;

  -- Leads de ESTA campaña con esos emails (uno por email).
  create temp table if not exists _imp_hit (email text primary key, lead_id uuid) on commit drop;
  truncate _imp_hit;
  insert into _imp_hit (email, lead_id)
  select distinct on (l.email) l.email, l.id
    from _imp_in i
    join leads l on l.user_id = v_uid and l.email = i.email
    join campaign_leads cl on cl.lead_id = l.id and cl.campaign_id = p_campaign
   order by l.email, l.created_at;

  update leads l
     set custom_fields = coalesce(l.custom_fields, '{}'::jsonb) || i.cf,
         verification_status = coalesce(i.vs, l.verification_status)
    from _imp_hit h join _imp_in i on i.email = h.email
   where l.id = h.lead_id
     and (coalesce(l.custom_fields, '{}'::jsonb) || i.cf is distinct from l.custom_fields
          or (i.vs is not null and i.vs is distinct from l.verification_status));
  get diagnostics v_updated = row_count;

  with ins as (
    insert into leads (user_id, email, custom_fields, is_campaign_only, verification_status)
    select v_uid, i.email, i.cf, true, i.vs
      from _imp_in i
     where not exists (select 1 from _imp_hit h where h.email = i.email)
    returning id
  )
  insert into campaign_leads (campaign_id, lead_id)
  select p_campaign, id from ins
  on conflict (campaign_id, lead_id) do nothing;
  get diagnostics v_added = row_count;

  return json_build_object('input', v_input, 'added', v_added, 'updated', v_updated);
end;
$$;
revoke all on function public.import_campaign_leads(uuid, jsonb) from public, anon;
grant execute on function public.import_campaign_leads(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
