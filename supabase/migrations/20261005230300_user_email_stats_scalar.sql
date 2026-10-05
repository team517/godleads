-- user_email_stats: the domain check of unlinked replies goes message by message (a scalar
-- subquery with LIMIT 1 against idx_leads_user_domain). With EXISTS the planner preferred reading
-- all 246,242 leads of support@ to build a hash (440 ms). Same result in 17/17 users.
-- support@: 593 ms -> 272 ms warm (was 3.9-5.9 s before 20261005230000).
CREATE OR REPLACE FUNCTION public.user_email_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as (
    select sent_at, opened_at, bounced_at, status, lower(to_email) as em
    from sent_emails where user_id = auth.uid()
  ),
  went as (select * from e where sent_at is not null or status in ('sent','bounced'))
  select json_build_object(
    'sent',      (select count(*) from went),
    'contacted', (select count(distinct em) from went where em is not null and em <> ''),
    'bounced', (select count(*) from e where bounced_at is not null or status='bounced'),
    'opened',  (select count(*) from e where opened_at is not null),
    'replied', (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and (m.lead_id is not null or m.campaign_id is not null))
             + (select count(*) from inbox_messages m where m.user_id = auth.uid() and not m.is_archived
                  and m.lead_id is null and m.campaign_id is null and m.is_warmup is not true
                  and (select 1 from leads l
                        where l.user_id = auth.uid() and position('@' in l.email) > 0
                          and lower(split_part(l.email,'@',2)) = lower(split_part(m.from_email,'@',2))
                        limit 1) is not null),
    'failed',  (select count(distinct em) from e where status='failed' and em is not null
                  and em not in (select em from went where em is not null))
  );
$function$;
grant execute on function public.user_email_stats() to authenticated;
notify pgrst, 'reload schema';
