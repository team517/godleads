-- Chatbot (10-11-2026): conversaciones con historial, mensajes guardados y peticiones para hablar
-- con el equipo (desde la landing sin sesión o desde dentro con sesión). Pedido del dueño: "el
-- chatbot conversacional primero, modo edición para los que tienen perfil, hablar con el equipo
-- manda un correo a team@ y desde hello@ veo las peticiones y el historial".

create table if not exists public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,   -- null = visitante
  visitor_id       text,                                                -- id anónimo del navegador (visitante)
  title            text,
  mode             text not null default 'chat',                        -- chat | edicion | visitante
  message_count    int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  constraint chat_conversations_owner check (user_id is not null or visitor_id is not null)
);
create index if not exists chat_conversations_user_idx on public.chat_conversations (user_id, last_message_at desc) where user_id is not null;
create index if not exists chat_conversations_visitor_idx on public.chat_conversations (visitor_id, last_message_at desc) where visitor_id is not null;
create index if not exists chat_conversations_last_idx on public.chat_conversations (last_message_at desc);

create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.chat_conversations(id) on delete cascade,
  role             text not null check (role in ('user','assistant','system')),
  content          text not null default '',
  cards            jsonb,
  via              text,                                                -- consultor | pulsebot | visitante | equipo
  created_at       timestamptz not null default now()
);
create index if not exists chat_messages_conv_idx on public.chat_messages (conversation_id, created_at);

create table if not exists public.team_requests (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.chat_conversations(id) on delete set null,
  user_id          uuid references auth.users(id) on delete set null,
  visitor_id       text,
  name             text not null,
  email            text not null,
  company          text,
  phone            text,
  topic            text,
  message          text not null,
  transcript       jsonb,
  source           text not null check (source in ('visitor','user')),
  status           text not null default 'new' check (status in ('new','contacted','closed')),
  handled_by       text,
  handled_at       timestamptz,
  notified_at      timestamptz,
  notify_error     text,
  created_at       timestamptz not null default now()
);
create index if not exists team_requests_status_idx on public.team_requests (status, created_at desc);
create index if not exists team_requests_user_idx on public.team_requests (user_id) where user_id is not null;

-- Límite de visitantes por día (función chat-hub): cuántos mensajes ha mandado cada visitante / IP hoy.
create table if not exists public.chat_visitor_quota (
  key      text not null,          -- 'v:<visitor_id>' o 'ip:<ip>'
  day      date not null,
  count    int  not null default 0,
  primary key (key, day)
);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.team_requests enable row level security;
alter table public.chat_visitor_quota enable row level security;
revoke all on public.chat_visitor_quota from anon, authenticated;

-- Conversaciones: el usuario las suyas; el equipo (is_staff_caller) las ve todas, incluidas las de visitantes.
drop policy if exists "chat_conversations own" on public.chat_conversations;
create policy "chat_conversations own" on public.chat_conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "chat_conversations staff read" on public.chat_conversations;
create policy "chat_conversations staff read" on public.chat_conversations
  for select to authenticated using (public.is_staff_caller());

drop policy if exists "chat_messages own" on public.chat_messages;
create policy "chat_messages own" on public.chat_messages
  for all to authenticated
  using (exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
drop policy if exists "chat_messages staff read" on public.chat_messages;
create policy "chat_messages staff read" on public.chat_messages
  for select to authenticated using (public.is_staff_caller());

-- Peticiones: el usuario lee las suyas; el equipo lee y actualiza todas. Nadie inserta desde el
-- navegador: siempre por la función chat-hub (service role), que es quien manda el correo.
drop policy if exists "team_requests own read" on public.team_requests;
create policy "team_requests own read" on public.team_requests
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "team_requests staff read" on public.team_requests;
create policy "team_requests staff read" on public.team_requests
  for select to authenticated using (public.is_staff_caller());
drop policy if exists "team_requests staff update" on public.team_requests;
create policy "team_requests staff update" on public.team_requests
  for update to authenticated using (public.is_staff_caller()) with check (public.is_staff_caller());

-- updated_at / last_message_at / message_count al insertar mensajes.
create or replace function public.chat_messages_touch()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.chat_conversations
     set last_message_at = new.created_at, updated_at = now(), message_count = message_count + 1,
         title = coalesce(title, case when new.role = 'user' then left(regexp_replace(new.content, '\s+', ' ', 'g'), 80) end)
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists trg_chat_messages_touch on public.chat_messages;
create trigger trg_chat_messages_touch after insert on public.chat_messages
  for each row execute function public.chat_messages_touch();

-- Cuota diaria de visitantes: suma y devuelve el total del día (service role).
create or replace function public.chat_visitor_bump(p_key text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  insert into public.chat_visitor_quota (key, day, count) values (p_key, current_date, 1)
  on conflict (key, day) do update set count = public.chat_visitor_quota.count + 1
  returning count into n;
  return n;
end $$;
revoke all on function public.chat_visitor_bump(text) from public, anon, authenticated;
grant execute on function public.chat_visitor_bump(text) to service_role;
