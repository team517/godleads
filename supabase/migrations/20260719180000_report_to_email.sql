-- Reports are sent FROM one of the AGENCY's own connected accounts (report_from_account_id,
-- now the agency owner's account, not the client's) TO an email typed by hand
-- (report_to_email) — the client's contact address, which need NOT be a platform user.
alter table public.profiles add column if not exists report_to_email text;
