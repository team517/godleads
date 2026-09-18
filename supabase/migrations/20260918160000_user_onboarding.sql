-- Primer acceso: las respuestas de la pantalla de bienvenida (/bienvenida).
--
-- Una fila por usuario. Mientras no tenga `completed_at`, la aplicación le enseña la bienvenida
-- antes que ninguna otra pantalla; en cuanto la termina (o la omite), no vuelve a salir.
--
-- Las cuentas que YA existían se dan por hechas al final del archivo: la bienvenida es para quien
-- entra por primera vez, no para quien lleva meses trabajando.

create table if not exists public.user_onboarding (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  source        text,                       -- cómo nos ha encontrado
  source_other  text,                       -- lo que escribió si eligió "Otro"
  website       text,                       -- web de su empresa, ya normalizada
  goals         text[] not null default '{}',
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

drop policy if exists "onboarding: leer lo propio"   on public.user_onboarding;
drop policy if exists "onboarding: crear lo propio"  on public.user_onboarding;
drop policy if exists "onboarding: cambiar lo propio" on public.user_onboarding;

create policy "onboarding: leer lo propio"    on public.user_onboarding for select using (auth.uid() = user_id);
create policy "onboarding: crear lo propio"   on public.user_onboarding for insert with check (auth.uid() = user_id);
create policy "onboarding: cambiar lo propio" on public.user_onboarding for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cuentas existentes: ya están dentro, no se les interrumpe con la bienvenida.
insert into public.user_onboarding (user_id, completed_at)
select p.user_id, now() from public.profiles p where p.user_id is not null
on conflict (user_id) do nothing;
