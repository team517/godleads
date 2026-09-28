-- Borrar cuentas sin perder nada, y que vuelvan "como antes" si se suben otra vez.
--
-- 1) Borrar una cuenta fallaba siempre que tuviera leads asignados en alguna campaña
--    ("No se pudo aplicar en 160 de 160 cuenta(s)"): campaign_leads.assigned_account_id no tenía
--    acción al borrar y la base de datos rechazaba el DELETE. Ahora sus leads quedan sin cuenta
--    (el motor les asigna otra de la campaña) — igual que sent_emails, que ya se conservaba.
-- 2) Antes de borrar se guarda una copia (SIN contraseñas) en email_accounts_archive: ajustes,
--    etiquetas, campañas, leads asignados, envíos y las respuestas reales del Unibox (sin warm-up).
-- 3) Si el mismo usuario vuelve a subir ese email, la cuenta nueva recupera todo eso sola.
-- (La pantalla sólo deja borrar cuentas cuyas campañas estén pausadas.)

alter table public.campaign_leads drop constraint if exists campaign_leads_assigned_account_id_fkey;
alter table public.campaign_leads
  add constraint campaign_leads_assigned_account_id_fkey
  foreign key (assigned_account_id) references public.email_accounts(id) on delete set null;

create table if not exists public.email_accounts_archive (
  id           bigserial primary key,
  user_id      uuid not null,
  email        text not null,           -- en minúsculas
  deleted_at   timestamptz not null default now(),
  settings     jsonb not null default '{}'::jsonb,
  campaign_ids uuid[] not null default '{}',
  lead_ids     uuid[] not null default '{}',
  sent_ids     uuid[] not null default '{}',
  replies      jsonb not null default '[]'::jsonb,
  reply_logs   jsonb not null default '[]'::jsonb   -- [{log_id, message_id}] del agente de respuestas
);
create index if not exists email_accounts_archive_user_email_idx on public.email_accounts_archive (user_id, email);
alter table public.email_accounts_archive enable row level security;

create or replace function public.archive_email_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into email_accounts_archive (user_id, email, settings, campaign_ids, lead_ids, sent_ids, replies, reply_logs)
  values (
    old.user_id, lower(old.email),
    jsonb_build_object(
      'first_name', old.first_name, 'last_name', old.last_name, 'daily_limit', old.daily_limit,
      'send_start_hour', old.send_start_hour, 'send_end_hour', old.send_end_hour,
      'warmup_enabled', old.warmup_enabled, 'warmup_day', old.warmup_day, 'warmup_limit', old.warmup_limit,
      'warmup_increment', old.warmup_increment, 'warmup_started_at', old.warmup_started_at,
      'tags', to_jsonb(coalesce(old.tags, '{}'::text[])), 'signature_html', old.signature_html, 'notes', old.notes),
    coalesce((select array_agg(campaign_id) from campaign_accounts where account_id = old.id), '{}'),
    coalesce((select array_agg(id) from campaign_leads where assigned_account_id = old.id), '{}'),
    coalesce((select array_agg(id) from sent_emails where account_id = old.id), '{}'),
    coalesce((select jsonb_agg(to_jsonb(m)) from inbox_messages m
              where m.account_id = old.id and not coalesce(m.is_warmup, false)), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('log_id', l.id, 'message_id', l.inbox_message_id))
                from auto_reply_log l join inbox_messages m on m.id = l.inbox_message_id
               where m.account_id = old.id), '[]'::jsonb)
  );
  return old;
end $$;

drop trigger if exists archive_email_account_before_delete on public.email_accounts;
create trigger archive_email_account_before_delete
  before delete on public.email_accounts
  for each row execute function public.archive_email_account();

-- Al volver a subir la cuenta: los ajustes se recuperan ANTES de guardarla…
create or replace function public.restore_email_account_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare a email_accounts_archive; s jsonb;
begin
  select * into a from email_accounts_archive
   where user_id = new.user_id and email = lower(new.email) order by deleted_at desc limit 1;
  if not found then return new; end if;
  s := a.settings;
  new.first_name      := coalesce(nullif(new.first_name, ''), s->>'first_name');
  new.last_name       := coalesce(nullif(new.last_name, ''), s->>'last_name');
  new.daily_limit     := coalesce((s->>'daily_limit')::int, new.daily_limit);
  new.send_start_hour := coalesce((s->>'send_start_hour')::int, new.send_start_hour);
  new.send_end_hour   := coalesce((s->>'send_end_hour')::int, new.send_end_hour);
  if coalesce((s->>'warmup_enabled')::boolean, false) then
    new.warmup_enabled    := true;
    new.warmup_day        := coalesce((s->>'warmup_day')::int, new.warmup_day);
    new.warmup_limit      := coalesce((s->>'warmup_limit')::int, new.warmup_limit);
    new.warmup_increment  := coalesce((s->>'warmup_increment')::int, new.warmup_increment);
    new.warmup_started_at := coalesce((s->>'warmup_started_at')::timestamptz, new.warmup_started_at);
  end if;
  new.tags := array(select distinct t from unnest(coalesce(new.tags, '{}'::text[])
                    || array(select jsonb_array_elements_text(coalesce(s->'tags', '[]'::jsonb)))) t
                    where t is not null and t <> '');
  new.signature_html := coalesce(nullif(new.signature_html, ''), s->>'signature_html');
  new.notes          := coalesce(nullif(new.notes, ''), s->>'notes');
  return new;
end $$;

-- …y campañas, leads, envíos y respuestas DESPUÉS (necesitan el id nuevo).
create or replace function public.restore_email_account_links()
returns trigger language plpgsql security definer set search_path = public as $$
declare a email_accounts_archive;
begin
  select * into a from email_accounts_archive
   where user_id = new.user_id and email = lower(new.email) order by deleted_at desc limit 1;
  if not found then return new; end if;

  insert into campaign_accounts (campaign_id, account_id)
  select c.id, new.id from campaigns c where c.id = any(a.campaign_ids) and c.user_id = new.user_id
  on conflict do nothing;

  -- Sólo los leads que siguen sin cuenta (si el motor ya les dio otra, se respeta).
  update campaign_leads set assigned_account_id = new.id
   where id = any(a.lead_ids) and assigned_account_id is null;

  update sent_emails set account_id = new.id
   where id = any(a.sent_ids) and account_id is null;

  insert into inbox_messages
  select (jsonb_populate_record(null::inbox_messages, r || jsonb_build_object('account_id', new.id))).*
    from jsonb_array_elements(a.replies) r
  on conflict do nothing;

  -- Son respuestas VIEJAS: ni aviso al móvil otra vez ni el agente vuelve a contestarlas.
  insert into push_notified (message_id, user_id)
  select (r->>'id')::uuid, new.user_id from jsonb_array_elements(a.replies) r
   where exists (select 1 from inbox_messages m where m.id = (r->>'id')::uuid)
  on conflict do nothing;
  update auto_reply_log l set inbox_message_id = (x->>'message_id')::uuid
    from jsonb_array_elements(a.reply_logs) x
   where l.id = (x->>'log_id')::uuid and l.inbox_message_id is null
     and exists (select 1 from inbox_messages m where m.id = (x->>'message_id')::uuid);

  delete from email_accounts_archive where user_id = new.user_id and email = lower(new.email);
  return new;
end $$;

drop trigger if exists restore_email_account_before_insert on public.email_accounts;
create trigger restore_email_account_before_insert
  before insert on public.email_accounts
  for each row execute function public.restore_email_account_settings();

drop trigger if exists restore_email_account_after_insert on public.email_accounts;
create trigger restore_email_account_after_insert
  after insert on public.email_accounts
  for each row execute function public.restore_email_account_links();

revoke all on function public.archive_email_account() from public, anon, authenticated;
revoke all on function public.restore_email_account_settings() from public, anon, authenticated;
revoke all on function public.restore_email_account_links() from public, anon, authenticated;
