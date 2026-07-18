-- Keep report emails from "disappearing" in the Unibox.
--
-- The Unibox loads the ~1000 most recent non-archived messages. With warmup across
-- dozens of accounts, ~40-570 messages/hour arrive, so a self-sent report/test email
-- sinks below that window within a day and seems to vanish (it's NOT deleted — there
-- are 23k+ non-archived rows). It would also eventually be removed by the weekly
-- warmup purge (it has no lead_id/campaign_id).
--
-- Fix: auto-label report emails as 'Importante' on arrival. The "Importantes" tab
-- queries the DB directly (not the 1000-row window) so they're always findable, and
-- 'Importante' is already EXEMPT from purge_old_warmup — so they persist for good.

create or replace function public.tag_report_emails()
returns trigger
language plpgsql
as $$
begin
  if new.subject is not null
     and (new.subject ilike 'Análisis de tu campaña%' or new.subject ilike 'Análisis semanal de tu campaña%')
     and not coalesce(new.labels @> array['Importante']::text[], false)
  then
    new.labels := (
      select array_agg(distinct x)
      from unnest(coalesce(new.labels, array[]::text[]) || array['Importante']::text[]) as x
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tag_report_emails on public.inbox_messages;
create trigger trg_tag_report_emails
  before insert on public.inbox_messages
  for each row execute function public.tag_report_emails();

-- Back-label the report emails that already arrived (targeted to report subjects only).
update public.inbox_messages
set labels = (
  select array_agg(distinct x)
  from unnest(coalesce(labels, array[]::text[]) || array['Importante']::text[]) as x
)
where (subject ilike 'Análisis de tu campaña%' or subject ilike 'Análisis semanal de tu campaña%')
  and not coalesce(labels @> array['Importante']::text[], false);
