-- Auto-sync of Google Form responses, entirely inside Postgres (no edge deploy needed).
-- A pg_cron job calls sync_google_form_responses() every 2 min: it refreshes each owner's
-- Google access token and pulls new responses for their forms into form_responses.
-- Isolated from the sending engine.

create extension if not exists http with schema extensions;

-- OAuth app credentials (single row). Filled server-side; never exposed to clients.
create table if not exists public.google_oauth_config (
  id int primary key default 1,
  client_id text,
  client_secret text,
  updated_at timestamptz default now()
);
revoke all on public.google_oauth_config from anon, authenticated;

create or replace function public.sync_google_form_responses()
returns integer
language plpgsql
security definer
set search_path to public, extensions
as $$
declare
  cfg   record;
  conn  record;
  frm   record;
  at    text;
  resp  jsonb;
  item  jsonb;
  n     integer := 0;
begin
  select client_id, client_secret into cfg from public.google_oauth_config where id = 1;
  if cfg.client_id is null then return 0; end if;

  for conn in select owner_id, refresh_token from public.google_connections where refresh_token is not null loop
    begin
      at := (extensions.http_post(
        'https://oauth2.googleapis.com/token',
        'client_id=' || cfg.client_id || '&client_secret=' || cfg.client_secret ||
        '&grant_type=refresh_token&refresh_token=' || extensions.urlencode(conn.refresh_token),
        'application/x-www-form-urlencoded'
      )).content::jsonb ->> 'access_token';
    exception when others then at := null; end;
    if at is null then continue; end if;

    for frm in select form_id, name from public.google_forms where owner_id = conn.owner_id loop
      begin
        resp := (extensions.http((
          'GET',
          'https://forms.googleapis.com/v1/forms/' || frm.form_id || '/responses',
          array[extensions.http_header('Authorization', 'Bearer ' || at)],
          null,
          null
        )::extensions.http_request)).content::jsonb;
      exception when others then resp := null; end;
      if resp is null or not (resp ? 'responses') then continue; end if;

      for item in select * from jsonb_array_elements(resp->'responses') loop
        insert into public.form_responses(owner_id, form_id, form_title, respondent_email, answers, raw, provider_response_id, received_at)
        values (
          conn.owner_id, frm.form_id, frm.name,
          nullif(item->>'respondentEmail', ''),
          coalesce(item->'answers', '{}'::jsonb),
          item,
          item->>'responseId',
          coalesce((item->>'createTime')::timestamptz, now())
        )
        on conflict (owner_id, form_id, provider_response_id) do update set
          respondent_email = excluded.respondent_email,
          answers = excluded.answers,
          raw = excluded.raw,
          received_at = excluded.received_at;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end;
$$;

revoke all on function public.sync_google_form_responses() from public, anon, authenticated;
