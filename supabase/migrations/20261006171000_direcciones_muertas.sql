-- Menos rebotes (06-10-2026): no volver a escribir a una dirección que ya se sabe que no existe.
--
-- De los 298 rebotes "por dirección" de las últimas 24 h, 63 (21 %) eran direcciones que YA habían
-- rebotado antes (en otra campaña, otro cliente o una lista importada otra vez). Esta tabla guarda
-- cada dirección muerta (lo dice el servidor del destinatario: is_dead_address_bounce) y los dominios
-- sin servidor de correo (el motor los añade como '@dominio' al comprobar el DNS). El motor la mira
-- antes de enviar y, si está, da el lead por rebotado SIN enviar.
-- Sólo el service role la lee y escribe.
create table if not exists public.invalid_recipients (
  address text primary key,              -- dirección en minúsculas, o '@dominio' para todo un dominio
  reason text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  hits int not null default 1
);
alter table public.invalid_recipients enable row level security;
revoke all on public.invalid_recipients from anon, authenticated;

-- Cada rebote por dirección muerta (al insertarse ya rebotado por el motor, o al marcarse después por
-- el aviso que llega al buzón) apunta la dirección.
create or replace function public.record_dead_recipient()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.bounced_at is not null and (tg_op = 'INSERT' or old.bounced_at is null)
     and coalesce(new.to_email, '') like '%@%'
     and public.is_dead_address_bounce(new.error_message) then
    insert into public.invalid_recipients (address, reason)
    values (lower(trim(new.to_email)), left(new.error_message, 300))
    on conflict (address) do update set last_seen = now(), hits = public.invalid_recipients.hits + 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_record_dead_recipient on public.sent_emails;
create trigger trg_record_dead_recipient
  after insert or update of bounced_at on public.sent_emails
  for each row execute function public.record_dead_recipient();

-- Las que ya conocemos.
insert into public.invalid_recipients (address, reason, first_seen, last_seen, hits)
select lower(trim(to_email)), left(max(error_message), 300), min(bounced_at), max(bounced_at), count(*)
from public.sent_emails
where bounced_at is not null and coalesce(to_email, '') like '%@%' and public.is_dead_address_bounce(error_message)
group by 1
on conflict (address) do nothing;

-- ¿Se sabe que esta dirección (o su dominio) no recibe correo? Devuelve el motivo o null.
create or replace function public.recipient_invalid_reason(p_email text)
returns text
language sql stable security definer set search_path to 'public' as $fn$
  select reason from public.invalid_recipients
  where address in (lower(trim(p_email)), '@' || split_part(lower(trim(p_email)), '@', 2))
  limit 1;
$fn$;
revoke all on function public.recipient_invalid_reason(text) from public, anon, authenticated;
grant execute on function public.recipient_invalid_reason(text) to service_role;
