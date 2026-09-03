-- Lead import was crawling (stuck at 0/4014): the BEFORE INSERT trigger skip_blocked_leads runs a
-- blocklist lookup per row using lower(value), which the existing btree (user_id, entry_type, value)
-- can't serve → it scanned every blocklist row of the user (14.5k) PER LEAD ≈ 183 ms/row, so a
-- 2000-row batch took ~6 min. A functional index on lower(value) turns each lookup into an index
-- scan (~0.06 ms). The trigger is also split into two EXISTS so BOTH the email and the domain
-- branch are guaranteed to hit the functional index.
-- NOT `concurrently`: supabase db push wraps each migration in a transaction and
-- CREATE INDEX CONCURRENTLY is illegal there (it would roll back the whole file, trigger
-- included). The table is small (~50k rows) so the plain form only blocks writes for ms.
-- (Already applied live via CONCURRENTLY; `if not exists` makes this a no-op there.)
create index if not exists idx_blocklist_user_type_lowerval
  on public.blocklist (user_id, entry_type, lower(value));

create or replace function public.skip_blocked_leads()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  dom text;
begin
  if new.email is null then return new; end if;
  dom := lower(split_part(new.email, '@', 2));
  if exists (
        select 1 from public.blocklist b
        where b.user_id = new.user_id and b.entry_type = 'email' and lower(b.value) = lower(new.email))
     or exists (
        select 1 from public.blocklist b
        where b.user_id = new.user_id and b.entry_type = 'domain' and lower(b.value) = dom)
  then
    return null; -- blocked → do not insert this row
  end if;
  return new;
end;
$$;
