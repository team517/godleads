-- Keep the inbox lean at scale: warmup mail piles up in inbox_messages (78k rows, ~99% is
-- warmup noise with NO lead_id/campaign_id). This function deletes ONLY that noise —
-- unlinked, old, unlabeled — and NEVER touches real replies (lead_id/campaign_id), recent
-- messages, or starred/important ones. Run weekly via pg_cron.
-- (Function applied in prod 2026-07-18; schedule the cron in the SQL editor — see bottom.)

create or replace function public.purge_old_warmup(p_days int default 7)
returns integer language plpgsql security definer set search_path=public as $$
declare v_deleted integer;
begin
  delete from public.inbox_messages
  where lead_id is null and campaign_id is null
    and received_at < now() - (p_days || ' days')::interval
    and (labels is null or array_length(labels, 1) is null);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;

-- Run in the Supabase SQL editor to schedule it (every Sunday 03:00 UTC):
--   select cron.schedule('purge-warmup-weekly', '0 3 * * 0', $$select public.purge_old_warmup(7)$$);
-- And once, to clean the current backlog immediately:
--   select public.purge_old_warmup(7);
