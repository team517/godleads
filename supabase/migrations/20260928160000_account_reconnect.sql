-- Reconexión automática de cuentas desconectadas: cuántas veces se ha intentado y cuándo toca el
-- siguiente intento. La escribe el monitor de salud (service role); sin policies para el navegador.
create table if not exists public.account_reconnect (
  account_id  uuid primary key references public.email_accounts(id) on delete cascade,
  intentos    int  not null default 0,
  next_at     timestamptz,
  last_error  text,
  reconectada_at timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.account_reconnect enable row level security;

-- Registro de reconexiones hechas (para verlo y para el aviso).
create table if not exists public.account_reconnect_log (
  id          bigserial primary key,
  account_id  uuid references public.email_accounts(id) on delete cascade,
  email       text,
  resultado   text not null,          -- reconectada | sigue_fallando
  detalle     text,
  created_at  timestamptz not null default now()
);
create index if not exists account_reconnect_log_created_idx on public.account_reconnect_log (created_at desc);
alter table public.account_reconnect_log enable row level security;
