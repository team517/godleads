-- Resultado de la comprobación DNS (SPF · DKIM · DMARC) de cada dominio, guardado.
--
-- Antes se comprobaba EN VIVO en cada carga de "Cuentas": ~43 dominios contra Google DNS, en olas,
-- así que la columna "Configuración" pasaba un buen rato en "Comprobando…". El DNS es público y
-- cambia poco, así que se guarda el veredicto y la pantalla lo enseña YA PUESTO; sólo se vuelve a
-- mirar en segundo plano cuando está viejo.
--
-- Es información de DNS público (no hay secretos), por eso cualquier usuario autenticado puede
-- leerla; sólo la escribe la función check-email-domain-auth (service role).

create table if not exists public.domain_auth (
  domain      text primary key,
  spf         text,          -- pass | warn | fail
  dkim        text,
  dmarc       text,
  ok          boolean,       -- los tres correctos
  checked_at  timestamptz not null default now()
);

alter table public.domain_auth enable row level security;

drop policy if exists "domain_auth: leer autenticado" on public.domain_auth;
create policy "domain_auth: leer autenticado" on public.domain_auth for select to authenticated using (true);
-- Sin políticas de escritura: sólo el service role (la edge function) escribe.
