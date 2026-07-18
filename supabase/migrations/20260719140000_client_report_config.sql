-- Phase 2 of the automated client reports: per-client configuration on the profile.
-- (A "client" is a sub-user whose profiles row has allowed_routes — see ClientPortal.)
--
--   report_enabled                → master on/off for that client's automated reports
--   report_from_account_id        → which email_accounts row the report is SENT FROM
--   report_low_contacts_threshold → warn the client when pending contacts drop below this
--   report_last_48h_at / _weekly_at → set by the scheduler (Phase 3) so the 48h/weekly
--                                     jobs debounce and don't double-send
--
-- Nothing auto-sends until report_enabled is true for a client (default false), so this
-- migration is inert on its own.

alter table public.profiles
  add column if not exists report_enabled boolean not null default false,
  add column if not exists report_from_account_id uuid,
  add column if not exists report_low_contacts_threshold integer not null default 200,
  add column if not exists report_last_48h_at timestamptz,
  add column if not exists report_last_weekly_at timestamptz;
