-- Chat en directo con el equipo (10-11-2026), estilo Smartlead / Intercom. Pedido del dueño: "que tú
-- puedas meter y enviar los mensajes por ahí y yo puedo verlos desde mi panel de hello@ y
-- responderlos desde ahí; no formulario: una conversación; los mensajes me llegan a mí".
--
-- Una conversación del chatbot (chat_conversations) pasa a tener un HILO CON EL EQUIPO:
--   team_status  none (sólo IA) | open (hablando con el equipo) | closed (el equipo lo cerró)
--   team_unread  mensajes del cliente sin leer por el equipo
--   user_unread  respuestas del equipo sin leer por el cliente
-- Los mensajes del cliente al equipo van con via = 'cliente_equipo'; las respuestas del equipo con
-- via = 'equipo' y author_email (quién respondió). Todo lo escribe la función chat-hub (service role);
-- la RLS añade lectura/escritura del equipo por si se usa desde el panel.

alter table public.chat_conversations add column if not exists team_status text not null default 'none';
alter table public.chat_conversations add column if not exists team_opened_at timestamptz;
alter table public.chat_conversations add column if not exists team_unread int not null default 0;
alter table public.chat_conversations add column if not exists user_unread int not null default 0;
alter table public.chat_conversations add column if not exists last_team_reply_at timestamptz;
alter table public.chat_conversations add column if not exists last_client_message_at timestamptz;
alter table public.chat_conversations add column if not exists contact_email text;
alter table public.chat_conversations add column if not exists contact_name text;
alter table public.chat_conversations add column if not exists last_notified_at timestamptz;
-- Última vez que el cliente tenía el chat abierto (sondeo): si está mirando, no se le manda correo.
alter table public.chat_conversations add column if not exists client_seen_at timestamptz;
alter table public.chat_conversations add column if not exists page_url text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_conversations_team_status_check') then
    alter table public.chat_conversations add constraint chat_conversations_team_status_check
      check (team_status in ('none', 'open', 'closed'));
  end if;
end $$;

alter table public.chat_messages add column if not exists author_email text;
alter table public.chat_messages add column if not exists author_name text;

create index if not exists chat_conversations_team_idx
  on public.chat_conversations (team_status, last_message_at desc) where team_status <> 'none';

-- Contadores: un mensaje del cliente al equipo suma a team_unread; una respuesta del equipo suma a
-- user_unread. Los mensajes con la IA (via consultor/pulsebot/visitante) no tocan los contadores.
create or replace function public.chat_messages_touch()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.chat_conversations
     set last_message_at = new.created_at,
         updated_at = now(),
         message_count = message_count + 1,
         title = coalesce(title, case when new.role = 'user' then left(regexp_replace(new.content, '\s+', ' ', 'g'), 80) end),
         team_unread = team_unread + case when new.role = 'user' and new.via = 'cliente_equipo' then 1 else 0 end,
         last_client_message_at = case when new.role = 'user' and new.via = 'cliente_equipo' then new.created_at else last_client_message_at end,
         user_unread = user_unread + case when new.role = 'assistant' and new.via = 'equipo' and new.author_email is not null then 1 else 0 end,
         last_team_reply_at = case when new.role = 'assistant' and new.via = 'equipo' and new.author_email is not null then new.created_at else last_team_reply_at end
   where id = new.conversation_id;
  return new;
end $$;

-- RLS del equipo: además de leer (ya existía), escribir respuestas y cambiar el estado del hilo.
drop policy if exists "chat_messages staff reply" on public.chat_messages;
create policy "chat_messages staff reply" on public.chat_messages
  for insert to authenticated
  with check (public.is_staff_caller() and via = 'equipo' and role = 'assistant');
drop policy if exists "chat_conversations staff update" on public.chat_conversations;
create policy "chat_conversations staff update" on public.chat_conversations
  for update to authenticated using (public.is_staff_caller()) with check (public.is_staff_caller());
