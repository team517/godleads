-- Containment (06-10-2026, audit P0): four backup tables created by hand on 05-10 with
-- CREATE TABLE AS inherited the default grants of the public schema (SELECT for anon and
-- authenticated) and had no RLS, so anyone with the publishable anon key could read 3,900 message
-- bodies through PostgREST. Now: RLS on, no policies (service_role only), grants revoked.
-- The other backup_* tables already had RLS on without policies.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'backup\_%' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
-- Also for anything created the same way in the future: new tables in public no longer get
-- SELECT for anon/authenticated by default (RLS policies still grant access where they exist).
alter default privileges in schema public revoke select on tables from anon;
