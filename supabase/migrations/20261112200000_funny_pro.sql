-- Funny Pro (12-11-2026): formación 1:1 de 350 € (pago único). Al pagar con el enlace de Stripe, el
-- webhook firmado guarda la compra aquí; la página /funny-pro sólo abre la agenda cuando hay compra.
-- Nadie la escribe desde el navegador: sólo el servidor (service role).
create table if not exists public.funny_pro_purchases (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  user_id           uuid references auth.users(id) on delete set null,
  email             text,
  amount_cents      integer,
  currency          text,
  paid_at           timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists funny_pro_purchases_user_idx on public.funny_pro_purchases (user_id);
create index if not exists funny_pro_purchases_email_idx on public.funny_pro_purchases (lower(email));
alter table public.funny_pro_purchases enable row level security;
revoke all on public.funny_pro_purchases from anon, authenticated;

-- ¿Ha pagado Funny Pro quien tiene la sesión? Por su usuario o, si pagó desde la landing antes de
-- tener cuenta, por su correo de acceso. Devuelve sólo si está pagado y cuándo.
create or replace function public.my_funny_pro()
returns table(paid boolean, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select true, max(p.paid_at)
  from funny_pro_purchases p
  where p.user_id = auth.uid()
     or (p.email is not null and lower(p.email) = lower((select u.email from auth.users u where u.id = auth.uid())))
  having count(*) > 0;
$$;
revoke all on function public.my_funny_pro() from public;
grant execute on function public.my_funny_pro() to authenticated;
