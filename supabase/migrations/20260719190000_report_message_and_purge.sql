-- (1) Store the exact email MESSAGE sent with each report, so the history shows it.
alter table public.client_reports add column if not exists message text;

-- (2) List report PDFs older than N days, so a cron can purge them from storage
--     (keeps the platform lean). service_role-only.
create or replace function public.list_old_report_pdfs(p_days int default 10)
returns setof text
language sql
security definer
set search_path = storage, public
stable
as $$
  select name
  from storage.objects
  where bucket_id = 'client-reports'
    and created_at < now() - make_interval(days => p_days);
$$;

revoke all on function public.list_old_report_pdfs(int) from public, anon, authenticated;
grant execute on function public.list_old_report_pdfs(int) to service_role;
